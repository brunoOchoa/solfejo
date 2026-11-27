import { defineConfig } from 'vite';

// Hosts de túnel liberados (ngrok): o Vite bloqueia hosts desconhecidos. O ponto inicial libera todos os subdomínios.
const tunnelHosts = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'];

// base relativo: funciona em qualquer subcaminho (GitHub Pages, etc.)
export default defineConfig({
  base: './',
  server: { allowedHosts: tunnelHosts },
  preview: { allowedHosts: tunnelHosts },
});
