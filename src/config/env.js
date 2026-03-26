import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

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

const PORT = lerTextoEnv('PORT', '5232');
const TRIER_BASE_URL = lerTextoEnv('TRIER_BASE_URL', DEFAULT_TRIER_BASE_URL).replace(/\/+$/, '');
const TRIER_TOKEN = lerTextoEnv('TRIER_TOKEN');
const OPENAI_API_KEY = lerTextoEnv('OPENAI_API_KEY');

export { carregarEnv, PORT, TRIER_BASE_URL, TRIER_TOKEN, OPENAI_API_KEY };
