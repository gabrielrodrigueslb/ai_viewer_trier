const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_TRIER_BASE_URL = 'https://api-sgf-gateway.triersistemas.com.br/sgfpod1';

let envCarregado = false;

function carregarArquivoEnv(nomeArquivo, override = false) {
  const caminhoCompleto = path.resolve(process.cwd(), nomeArquivo);
  if (!fs.existsSync(caminhoCompleto)) {
    return;
  }

  dotenv.config({
    path: caminhoCompleto,
    override,
    quiet: true,
  });
}

function carregarEnv() {
  if (envCarregado) {
    return;
  }

  carregarArquivoEnv('.env');
  carregarArquivoEnv('.env.local', true);
  envCarregado = true;
}

function lerTextoEnv(nomeVariavel, valorPadrao = '') {
  return String(process.env[nomeVariavel] ?? valorPadrao).trim();
}

carregarEnv();

module.exports = {
  carregarEnv,
  PORT: lerTextoEnv('PORT', '5232'),
  TRIER_BASE_URL: lerTextoEnv('TRIER_BASE_URL', DEFAULT_TRIER_BASE_URL).replace(/\/+$/, ''),
  TRIER_TOKEN: lerTextoEnv('TRIER_TOKEN'),
  OPENAI_API_KEY: lerTextoEnv('OPENAI_API_KEY'),
};
