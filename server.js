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

// Sesiones: token -> { sede }
// Contador por sede: sede -> número de imágenes restantes
const sessionsByToken = {};
const countersBySede = {};

// Endpoint /login
app.post("/login", (req, res) => {
  const { sede, password } = req.body;
  if (!sede || !password) {
    return res.status(400).json({ error: "Sede y contraseña son requeridos." });
  }

  const user = allowedSedes.find(u => u.sede === sede && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }

  // Inicializa contador en 50 si no existe
  if (countersBySede[sede] === undefined) {
    countersBySede[sede] = 50;
  }

  // Reutilizar token si ya existe
  const existingToken = Object.keys(sessionsByToken).find(t => sessionsByToken[t].sede === sede);
  if (existingToken) {
    return res.json({ token: existingToken, counter: countersBySede[sede] });
  }

  // Crear token nuevo
  const token = crypto.randomBytes(16).toString("hex");
  sessionsByToken[token] = { sede };
  res.json({ token, counter: countersBySede[sede] });
});

// Middleware de autenticación
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

  if (countersBySede[sede] === undefined) {
    countersBySede[sede] = 50;
  }
  if (countersBySede[sede] <= 0) {
    return res.status(403).json({ error: "Límite de generación de imágenes alcanzado." });
  }

  // Decrementar contador
  countersBySede[sede]--;

  try {
    const { respuestas } = req.body;
    if (!respuestas || respuestas.length < 4) {
      return res.status(400).json({
        error: "Se requieren 4 respuestas para generar la ilustración."
      });
    }

    // Respuestas:
    // 0: ¿Qué te motiva todos los días a ser tu mejor versión?
    // 1: ¿Qué hábitos saludables tiene tu mejor versión?
    // 2: ¿Qué te detiene hoy de ser tu mejor versión?
    // 3: ¿Qué consejo le darías a tu yo de hace 5 años?

    const finalPrompt = `
Por favor, crea una ilustración de estilo doodle minimalista que represente la motivación y emociones del usuario sobre la construcción de hábitos saludables.
El usuario ha respondido:
1) Lo que le motiva a ser su mejor versión: "${respuestas[0]}"
2) Los hábitos saludables que tiene su mejor versión: "${respuestas[1]}"
3) Lo que le detiene hoy de ser su mejor versión: "${respuestas[2]}"
4) El consejo que se daría a su yo de hace 5 años: "${respuestas[3]}"

La imagen debe transmitir los sentimientos y aspiraciones del usuario en relación con su bienestar, usando elementos simbólicos sutiles y orgánicos (sin que el usuario los elija específicamente). 
Incluye una frase de manifestación o empoderamiento en español que resuma la esencia del usuario y lo que quiere recordarse cada día, inspirada en estas respuestas. 
La ilustración debe ser sencilla, limpia e inspiradora, reforzando el mensaje de bienestar y crecimiento personal. 
No uses fotorealismo ni 3D. 
Ten un enfoque de doodle lineal minimalista con colores suaves y cálidos.
    `;

    console.log("🔹 Generating image with prompt:", finalPrompt);

    // Llamada a la API de Leonardo
    const postResponse = await axios.post(
      "https://cloud.leonardo.ai/api/rest/v1/generations",
      {
        alchemy: true,
        height: 768,
        width: 1024,
        modelId: "b24e16ff-06e3-43eb-8d33-4416c2d75876",
        num_images: 1,
        presetStyle: "DYNAMIC",
        prompt: finalPrompt
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
      throw new Error("No generation job returned from API");
    }

    const generationId = postResponse.data.sdGenerationJob.generationId;
    console.log("Generation ID:", generationId);

    // Polling para obtener la imagen
    let imageUrl = null;
    let pollAttempts = 0;
    const maxAttempts = 20;
    while (pollAttempts < maxAttempts && !imageUrl) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5s
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
      return res.status(500).json({ error: "No image returned from API after polling" });
    }

    console.log("✅ Image URL:", imageUrl);
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
