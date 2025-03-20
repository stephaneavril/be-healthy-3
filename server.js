require('dotenv').config({ path: require('path').join(__dirname, '.env') });
console.log("🔑 Leonardo API Key:", process.env.LEONARDO_API_KEY || "❌ No cargada");

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

const LEONARDO_API_KEY = process.env.LEONARDO_API_KEY;
const PORT = process.env.PORT || 8080;

if (!LEONARDO_API_KEY) {
  console.error("❌ ERROR: Leonardo API Key is missing! Check your .env file.");
  process.exit(1);
}

// -------------------- Autenticación y contador --------------------

// Sedes autorizadas (nombre y contraseña)
const allowedSedes = [
  { sede: "sede1", password: "clave1" },
  { sede: "sede2", password: "clave2" }
];

// Almacenamiento en memoria:
// sessionsByToken: token -> { sede }
// countersBySede: sede -> número de imágenes disponibles
const sessionsByToken = {};
const countersBySede = {};

// Endpoint de login
app.post("/login", (req, res) => {
  const { sede, password } = req.body;
  if (!sede || !password) {
    return res.status(400).json({ error: "Sede y contraseña son requeridos." });
  }
  const user = allowedSedes.find(u => u.sede === sede && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }
  // Si es la primera vez que esta sede hace login, inicializa su contador
  if (countersBySede[sede] === undefined) {
    countersBySede[sede] = 50;
  }
  // Reutiliza token si ya existe para la misma sede
  const existingToken = Object.keys(sessionsByToken).find(t => sessionsByToken[t].sede === sede);
  if (existingToken) {
    return res.json({ token: existingToken, counter: countersBySede[sede] });
  }
  // Genera un nuevo token
  const token = crypto.randomBytes(16).toString("hex");
  sessionsByToken[token] = { sede };
  return res.json({ token, counter: countersBySede[sede] });
});

// Middleware para autenticar
function authenticate(req, res, next) {
  const token = req.header("x-auth-token");
  if (!token || !sessionsByToken[token]) {
    return res.status(401).json({ error: "No autorizado. Inicie sesión." });
  }
  req.sede = sessionsByToken[token].sede;
  next();
}

// -------------------- Endpoint /generate (protegido) --------------------
app.post("/generate", authenticate, async (req, res) => {
  const sede = req.sede;
  // Asegura que haya un contador para la sede
  if (countersBySede[sede] === undefined) {
    countersBySede[sede] = 50;
  }
  // Verifica si la sede aún tiene créditos
  if (countersBySede[sede] <= 0) {
    return res.status(403).json({ error: "Límite de generación de imágenes alcanzado." });
  }
  countersBySede[sede]--;

  try {
    const { respuestas } = req.body;
    if (!respuestas || respuestas.length < 4) {
      return res.status(400).json({ error: "Se requieren 4 respuestas para generar la ilustración." });
    }

    // Ajusta las respuestas (por si vienen vacías)
    const r1 = respuestas[0] || "Sin respuesta";
    const r2 = respuestas[1] || "Sin respuesta";
    const r3 = respuestas[2] || "Sin respuesta";
    const r4 = respuestas[3] || "Sin respuesta";

    // Construir el prompt enfatizando un estilo 2D, doodle minimalista, line-art
    const finalPrompt = `
Crea una ilustración 2D en estilo doodle minimalista (line-art, trazos simples, colores planos suaves, sin sombras realistas).
Representa cómo la persona se motiva con "${r1}", practica hábitos saludables como "${r2}", y enfrenta el obstáculo de "${r3}".
Incorpora una frase de empoderamiento en español basada en la respuesta 4 ("${r4}"), que refuerce la idea de bienestar y crecimiento personal.
El diseño debe ser simple, optimista, con un personaje o símbolos que muestren estas ideas. No uses fotorealismo ni 3D.
    `;

    console.log("🔹 Generating image with prompt:", finalPrompt);

    // Llamada a la API de Leonardo usando el modelo "Leonardo Diffusion"
    const postResponse = await axios.post(
      "https://cloud.leonardo.ai/api/rest/v1/generations",
      {
        alchemy: true,
        height: 512,
        width: 512,
        modelId: "b24e16ff-06e3-43eb-8d33-4416c2d75876",  // Leonardo Diffusion
        num_images: 1,
        presetStyle: "NONE",
        prompt: finalPrompt,
        negative_prompt:
          "3D, photorealistic, realistic, hyperrealistic, painting, photograph, cinematic lighting, " +
          "highly detailed, intricate shading, realism, 3D shapes, real life, complex background, " +
          "text glitch, text artifacts, blur, distortion, statue, sculpture, 3D render, CG, ultra-detailed"
      },
      {
        headers: {
          "Authorization": `Bearer ${LEONARDO_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    );

    if (!postResponse.data || !postResponse.data.sdGenerationJob) {
      throw new Error("No se retornó un job de generación desde la API");
    }

    const generationId = postResponse.data.sdGenerationJob.generationId;
    console.log("Generation ID:", generationId);

    // Polling para obtener la imagen generada
    let imageUrl = null;
    let pollAttempts = 0;
    const maxAttempts = 20;
    while (pollAttempts < maxAttempts && !imageUrl) {
      // Espera 5 segundos antes de cada intento
      await new Promise(resolve => setTimeout(resolve, 5000));
      pollAttempts++;
      console.log(`Polling attempt ${pollAttempts} for generation ID ${generationId}...`);

      const pollResponse = await axios.get(
        `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
        {
          headers: {
            "Authorization": `Bearer ${LEONARDO_API_KEY}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          }
        }
      );

      if (
        pollResponse.data &&
        pollResponse.data.generations_by_pk &&
        pollResponse.data.generations_by_pk.generated_images &&
        pollResponse.data.generations_by_pk.generated_images.length > 0
      ) {
        imageUrl = pollResponse.data.generations_by_pk.generated_images[0].url;
        break;
      }
    }

    if (!imageUrl) {
      return res.status(500).json({ error: "No se obtuvo imagen de la API después de varios intentos" });
    }

    console.log("✅ Image URL:", imageUrl);
    // Devolvemos la URL de la imagen y el contador restante
    res.json({ image_url: imageUrl, remaining: countersBySede[sede] });
  } catch (error) {
    console.error("❌ Error generating image:", error.response?.data || error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// -------------------- Endpoint /print-label (público) --------------------
app.get("/print-label", (req, res) => {
  const imageUrl = req.query.image;
  if (!imageUrl) {
    return res.status(400).send("Falta la URL de la imagen en el parámetro 'image'");
  }
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Imprimir Etiqueta</title>
    <style>
      @page {
        size: 2in 3in;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        width: 2in;
        height: 3in;
      }
      img {
        width: 100%;
        height: auto;
        display: block;
      }
    </style>
  </head>
  <body>
    <img src="${imageUrl}" alt="Etiqueta">
    <script>
      window.onload = () => {
        window.print();
      };
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
