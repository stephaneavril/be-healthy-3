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
const allowedSedes = [
  { sede: "sede1", password: "clave1" },
  { sede: "sede2", password: "clave2" }
];

const sessionsByToken = {};
const countersBySede = {};

app.post("/login", (req, res) => {
  const { sede, password } = req.body;
  if (!sede || !password) {
    return res.status(400).json({ error: "Sede y contraseña son requeridos." });
  }
  const user = allowedSedes.find(u => u.sede === sede && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }
  if (countersBySede[sede] === undefined) {
    countersBySede[sede] = 50;
  }
  const existingToken = Object.keys(sessionsByToken).find(t => sessionsByToken[t].sede === sede);
  if (existingToken) {
    return res.json({ token: existingToken, counter: countersBySede[sede] });
  }
  const token = crypto.randomBytes(16).toString("hex");
  sessionsByToken[token] = { sede };
  return res.json({ token, counter: countersBySede[sede] });
});

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
  countersBySede[sede]--;

  try {
    const { respuestas } = req.body;
    if (!respuestas || respuestas.length < 4) {
      return res.status(400).json({ error: "Se requieren 4 respuestas para generar la ilustración." });
    }

    const r1 = respuestas[0] || "Sin respuesta";
    const r2 = respuestas[1] || "Sin respuesta";
    const r3 = respuestas[2] || "Sin respuesta";
    const r4 = respuestas[3] || "Sin respuesta";

    // Prompt muy estricto hacia lo "doodle 2D"
    const finalPrompt = `
Ilustración 2D en estilo doodle minimalista, line-art con colores planos (no sombras realistas).
Muestra un personaje cartoon (sin rasgos realistas) que represente la motivación: "${r1}" 
y hábitos saludables: "${r2}", superando el obstáculo: "${r3}".
Incluye una frase corta en español inspirada en "${r4}" (ejemplo: "Confía en ti", "Sé constante"), 
pero escrita de forma muy simple (puede ser texto suelto o en una burbuja). 
Fondo claro, paleta pastel. Sin realismo, sin detalles anatómicos, sin texturas fotográficas.
    `;

    console.log("🔹 Generating image with prompt:", finalPrompt);

    // Llamada a la API de Leonardo, generando 2 imágenes para tener opciones
    const postResponse = await axios.post(
      "https://cloud.leonardo.ai/api/rest/v1/generations",
      {
        alchemy: true,
        height: 512,
        width: 512,
        modelId: "b24e16ff-06e3-43eb-8d33-4416c2d75876",  // Leonardo Diffusion
        num_images: 2,  // Generamos 2 imágenes para elegir
        presetStyle: "NONE",
        prompt: finalPrompt,
        negative_prompt: [
          // Palabras que queremos evitar
          "photo",
          "photorealistic",
          "realistic",
          "hyperrealistic",
          "3D",
          "3d render",
          "complex shading",
          "ultra-detailed",
          "dark lighting",
          "painting",
          "photograph",
          "cinematic lighting",
          "complex background",
          "real life",
          "blurry",
          "distorted",
          "sculpture",
          "statue",
          "model",
          "face details",
          "detailed clothing",
          "building",
          "architecture",
          "landscape",
          "shadows",
          "detail",
          "real person",
          "woman in dress",
          "man in suit",
          "portrait",
          "hyper detail",
          "hyper realistic",
          "photoreal",
          "photo portrait",
          "skin detail",
          "anatomy"
        ].join(", ")
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

    // Polling para obtener la imagen
    let imageUrl = null;
    let pollAttempts = 0;
    const maxAttempts = 20;

    // Vamos a guardar todas las imágenes que aparezcan
    let generatedImages = [];

    while (pollAttempts < maxAttempts && generatedImages.length === 0) {
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
        generatedImages = pollResponse.data.generations_by_pk.generated_images.map(img => img.url);
      }
    }

    if (generatedImages.length === 0) {
      return res.status(500).json({ error: "No se obtuvieron imágenes de la API después de varios intentos" });
    }

    // Tomamos la primera imagen, o podríamos devolver varias
    imageUrl = generatedImages[0];
    console.log("✅ Image URLs:", generatedImages);

    // Devolvemos la primera imagen y el contador restante
    res.json({ image_url: imageUrl, remaining: countersBySede[sede], all_images: generatedImages });
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
