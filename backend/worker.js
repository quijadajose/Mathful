const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const contento = `Eres un profesor de matemáticas, si te envían un problema resuelvo paso a paso, retorna html para los títulos y la estructura de la respuesta, para escribir matemáticas usa este formato \\[x = \\frac{{-b \\pm \\sqrt{{b^2 - 4ac}}}}{2a}\\] si consideras necesario graficar algo envíame los puntos o las funciones en un json dentro de una etiqueta <script>[{ id: 'graph1', latex: 'y=/x^3' },{ id: 'graph2', latex: 'y=/cos(x)' }]</script> yo voy a hacer un parseo, si no lo requieres no lo envíes`;
// ———————— Helpers ——————————

/** Añade cabeceras CORS a cualquier Response */
function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

/** Convierte ArrayBuffer a Base64 en Workers */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Invoca la API REST de Gemini para texto puro */
async function generarMensajeTexto(mensaje, env) {
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: `${contento}\n\nPregunta o problema: ${mensaje}` }]
    }]
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${env["GEMINI_API_KEY"]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text
    ?? '[Error]: no se obtuvo respuesta';
}

/** Invoca la API REST de Gemini para texto + imágenes */
async function generarDescripcion(mensaje, archivos, env) {
  const parts = [
    { text: `${contento}\n\nPregunta o problema: ${mensaje}` },
    ...archivos.map(f => ({
      inline_data: {
        mime_type: f.mimeType,
        data: f.base64
      }
    }))
  ];

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 512, temperature: 0.7 }
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${env["GEMINI_API_KEY"]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text
    ?? '[Error]: no se obtuvo descripción';
}

// ———————— Handler principal ——————————

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    // POST /generate-message
    if (request.method === 'POST' && pathname === '/generate-message') {
      try {
        const { message } = await request.json();
        if (!message) throw new Error('Falta el campo message');
        const texto = await generarMensajeTexto(message,env);
        return withCors(new Response(texto, { status: 200 }));
      } catch (e) {
        console.error(e);
        return withCors(new Response(
          JSON.stringify({ error: e.message }),
          { status: 500 }
        ));
      }
    }

    // POST /generate-description
    if (request.method === 'POST' && pathname === '/generate-description') {
      try {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.startsWith('multipart/form-data')) {
          throw new Error('Se esperaba multipart/form-data');
        }

        const formData = await request.formData();
        // Aceptar 'message' o 'text'
        const message = formData.get('message') || formData.get('text');
        if (typeof message !== 'string' || !message) {
          throw new Error('Falta el campo message');
        }

        // Procesar archivos de imagen
        const archivos = [];
        for (const file of formData.getAll('files')) {
          if (file instanceof File) {
            const arrayBuffer = await file.arrayBuffer();
            archivos.push({
              mimeType: file.type || 'application/octet-stream',
              base64: arrayBufferToBase64(arrayBuffer)
            });
          }
        }

        const descripcion = await generarDescripcion(message, archivos, env);
        return withCors(new Response(descripcion, { status: 200 }));

      } catch (e) {
        console.error(e);
        return withCors(new Response(
          JSON.stringify({ error: e.message }),
          { status: 500 }
        ));
      }
    }

    // Fallback 404
    return withCors(new Response('Not Found', { status: 404 }));
  }
};
