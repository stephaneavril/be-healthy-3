import leonardoai from '@leonardo-ai/sdk';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Verificar si la API Key está configurada
const API_KEY = process.env.LEONARDO_API_KEY;
if (!API_KEY) {
  console.error('❌ ERROR: Falta la API Key de Leonardo. Verifica tu .env');
  process.exit(1);
}

// Configurar el SDK de Leonardo AI con la API Key
const leonardo = new leonardoai(API_KEY);

// 🔥 Solicitud para generar una imagen
const generateImage = async () => {
  try {
    const response = await leonardo.createGeneration({
      modelId: 'b24e16ff-06e3-43eb-8d33-4416c2d75876', // Modelo Phoenix V2
      prompt: 'A majestic cat in the snow', // Cambia esto a lo que necesites
      width: 1024,
      height: 768,
      num_images: 1,
      presetStyle: 'DYNAMIC', // Puedes cambiar a otro estilo si lo deseas
      photoReal: true, // Activa fotorrealismo
      sd_version: 'v1_5', // Versión del modelo Stable Diffusion
      seed: Math.floor(Math.random() * 100000), // Genera una imagen única
    });

    // Verificar la respuesta de la API
    if (!response.data || response.data.length === 0) {
      throw new Error('No se generaron imágenes.');
    }

    // Obtener la URL de la imagen generada
    console.log('✅ Imagen generada:', response.data[0].url);

  } catch (error) {
    console.error('❌ Error generando la imagen:', error.response?.data || error.message);
  }
};

// Ejecutar la función para generar la imagen
generateImage();
