<<<<<<< HEAD
const axios = require('axios');
const { TRIER_BASE_URL, TRIER_TOKEN } = require('../config/env');
=======
import axios from 'axios';

const TRIER_BASE_URL = String(
  process.env.TRIER_BASE_URL || 'https://api-sgf-gateway.triersistemas.com.br/sgfpod1'
).trim();
const TRIER_TOKEN = String(process.env.TRIER_TOKEN || '').trim();
>>>>>>> b70b1db6688f2bca94508c064fc8c4c5923b1cf5

const PAGE_SIZE = 50;
const TIMEOUT_BUSCA = 20000;
const TIMEOUT_DESCONTO = 15000; // aumentado: API Trier é lenta nesses endpoints

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

function validarConfiguracaoTrier() {
  if (!TRIER_BASE_URL) {
    throw new Error('TRIER_BASE_URL não configurada. Defina a URL da API Trier em .env ou .env.local.');
  }

  if (!TRIER_TOKEN) {
    throw new Error('TRIER_TOKEN não configurado. Defina o token da API Trier em .env ou .env.local.');
  }
}

function criarCliente() {
  validarConfiguracaoTrier();

  return axios.create({
    baseURL: TRIER_BASE_URL,
    timeout: TIMEOUT_BUSCA,
    headers: {
      Authorization: `Bearer ${TRIER_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

function descreverErroTrier(erro) {
  const status = erro.response?.status;

  if (status === 498) {
    return 'Token Trier invalido/expirado, nao autorizado para esta URL ou com espacos extras no .env.';
  }

  if (status === 401 || status === 403) {
    return `Falha de autenticacao na Trier (HTTP ${status}).`;
  }

  return erro.message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcularScoreSimilaridade(nomeProduto, termoBusca) {
  const produto = normalizarTexto(nomeProduto);
  const busca = normalizarTexto(termoBusca);

  if (!produto || !busca) return 0;
  if (produto === busca) return 100;
  if (produto.startsWith(busca)) return 90;

  const palavrasBusca = busca.split(' ').filter(p => p.length > 1);
  const todasPresentes = palavrasBusca.every(palavra => produto.includes(palavra));
  if (todasPresentes) {
    const palavrasProduto = produto.split(' ').length;
    const bonus = Math.max(0, 10 - (palavrasProduto - palavrasBusca.length) * 2);
    return 70 + bonus;
  }

  const palavrasSignificativas = palavrasBusca.filter(p => p.length >= 3);
  const presentes = palavrasSignificativas.filter(palavra => produto.includes(palavra));
  if (presentes.length > 0) {
    return Math.round((presentes.length / palavrasSignificativas.length) * 50);
  }

  return 0;
}

// ─── Resolução de melhor preço ─────────────────────────────────────────────────
// Ordem: encarte > promoção > desconto_cadastrado > venda pura

function resolverMelhorPreco({ produto, melhorDesconto, encarte }) {
  const resultado = {
    preco_final: null,
    preco_sem_desconto: null,
    desconto_percentual: null,
    tipo_preco: null,
    nome_campanha: null,
    data_inicio: null,
    data_fim: null,
  };

  if (encarte && encarte.valorPromocao != null) {
    resultado.preco_final = Number(encarte.valorPromocao);
    resultado.preco_sem_desconto = Number(produto.valorVenda);
    resultado.tipo_preco = 'encarte';
    resultado.nome_campanha = encarte.nomeCampanha || null;
    resultado.data_inicio = encarte.dataInicio || null;
    resultado.data_fim = encarte.dataFim || null;
    if (resultado.preco_sem_desconto > resultado.preco_final) {
      resultado.desconto_percentual = Math.round(
        ((resultado.preco_sem_desconto - resultado.preco_final) / resultado.preco_sem_desconto) * 100
      );
    }
    return resultado;
  }

  if (melhorDesconto && melhorDesconto.valorPromocao != null) {
    resultado.preco_final = Number(melhorDesconto.valorPromocao);
    resultado.preco_sem_desconto = Number(produto.valorVenda);
    resultado.desconto_percentual = melhorDesconto.percentualDesconto
      ? Number(melhorDesconto.percentualDesconto)
      : null;
    resultado.tipo_preco = 'promocao';
    return resultado;
  }

  if (produto.percentualDesconto && Number(produto.percentualDesconto) > 0) {
    const desconto = Number(produto.percentualDesconto);
    const valorVenda = Number(produto.valorVenda);
    resultado.preco_sem_desconto = valorVenda;
    resultado.preco_final = parseFloat((valorVenda * (1 - desconto / 100)).toFixed(2));
    resultado.desconto_percentual = desconto;
    resultado.tipo_preco = 'desconto_cadastrado';
    return resultado;
  }

  if (produto.valorVenda != null) {
    resultado.preco_final = Number(produto.valorVenda);
    resultado.tipo_preco = 'venda';
    return resultado;
  }

  return resultado;
}

// ─── Extração de resposta ──────────────────────────────────────────────────────

function extrairListaDaResposta(data, endpoint) {
  if (Array.isArray(data)) {
    console.log(`[TRIER][${endpoint}] Array direto (${data.length} itens)`);
    return data;
  }

  if (data && typeof data === 'object') {
    const chaves = Object.keys(data);
    for (const chave of ['produtos', 'itens', 'data', 'result', 'registros', 'lista']) {
      if (Array.isArray(data[chave])) {
        console.log(`[TRIER][${endpoint}] Lista em data.${chave} (${data[chave].length} itens)`);
        return data[chave];
      }
    }
    for (const chave of chaves) {
      if (Array.isArray(data[chave])) {
        console.log(`[TRIER][${endpoint}] Lista em data.${chave} (${data[chave].length} itens)`);
        return data[chave];
      }
    }
    console.warn(`[TRIER][${endpoint}] Nenhuma lista encontrada:`, JSON.stringify(data).substring(0, 300));
  }

  return [];
}

// ─── Chamadas à API ────────────────────────────────────────────────────────────

async function buscarProdutoPorNome(cliente, nomeProduto) {
  const response = await cliente.get('/rest/integracao/produto/obter-v1', {
    params: { primeiroRegistro: 0, quantidadeRegistros: PAGE_SIZE, nomeProduto, ativo: true, processaCustoMedio: false },
  });
  console.log(`[TRIER] obter-v1 status: ${response.status}`);
  return extrairListaDaResposta(response.data, 'obter-v1');
}

async function buscarTodosProdutos(cliente, nomeProduto) {
  const response = await cliente.get('/rest/integracao/produto/obter-todos-v1', {
    params: { primeiroRegistro: 0, quantidadeRegistros: PAGE_SIZE, nomeProduto },
  });
  console.log(`[TRIER] obter-todos-v1 status: ${response.status}`);
  return extrairListaDaResposta(response.data, 'obter-todos-v1');
}

async function buscarMelhorDesconto(cliente, codigoProduto) {
  try {
    const response = await cliente.get('/rest/integracao/produto/desconto/melhor/obter-v1', {
      timeout: TIMEOUT_DESCONTO,
      params: { primeiroRegistro: 0, quantidadeRegistros: 1, codigoProduto },
    });
    const lista = extrairListaDaResposta(response.data, 'melhor-desconto');
    return lista.find(d => d.codigoProduto === codigoProduto) || null;
  } catch (erro) {
    console.warn(`[TRIER] melhor-desconto falhou [${codigoProduto}]: ${erro.message}`);
    return null;
  }
}

async function buscarDescontoEncarte(cliente, codigoProduto) {
  try {
    const response = await cliente.get('/rest/integracao/produto/desconto/encarte/obter-v1', {
      timeout: TIMEOUT_DESCONTO,
      params: { primeiroRegistro: 0, quantidadeRegistros: 1, codigoProduto },
    });
    const lista = extrairListaDaResposta(response.data, 'encarte');
    for (const encarte of lista) {
      const item = (encarte.produtosEncarte || []).find(p => p.codigoProduto === codigoProduto);
      if (item) {
        return { nomeCampanha: encarte.nomeCampanha, dataInicio: encarte.dataInicio, dataFim: encarte.dataFim, valorPromocao: item.valorPromocao };
      }
    }
    return null;
  } catch (erro) {
    console.warn(`[TRIER] encarte falhou [${codigoProduto}]: ${erro.message}`);
    return null;
  }
}

// ─── Enriquecimento sequencial ────────────────────────────────────────────────
// Processamento um produto de cada vez para não sobrecarregar a API da Trier.
// Cada produto dispara 2 requests em paralelo (melhor-desconto + encarte),
// mas aguarda terminar antes de passar para o próximo.

async function enriquecerProduto(cliente, produto) {
  const [melhorDesconto, encarte] = await Promise.all([
    buscarMelhorDesconto(cliente, produto.codigo),
    buscarDescontoEncarte(cliente, produto.codigo),
  ]);
  return { ...produto, preco: resolverMelhorPreco({ produto, melhorDesconto, encarte }) };
}

async function enriquecerSequencial(cliente, produtos) {
  const resultado = [];
  for (const produto of produtos) {
    const enriquecido = await enriquecerProduto(cliente, produto);
    resultado.push(enriquecido);
  }
  return resultado;
}

// ─── Filtro de relevância e estoque ───────────────────────────────────────────

const SCORE_MINIMO = 40;

function filtrarEOrdenarPorRelevancia(produtos, termoBusca) {
  return produtos
    .map(p => ({ ...p, _score: calcularScoreSimilaridade(p.nome, termoBusca) }))
    .filter(p => p._score >= SCORE_MINIMO)
    .sort((a, b) => b._score - a._score);
}

// Remove produtos sem estoque APÓS enriquecimento (estoque vem da busca principal)
function filtrarComEstoque(produtos) {
  const comEstoque = produtos.filter(p => (p.quantidadeEstoque ?? 0) > 0);
  const semEstoque = produtos.length - comEstoque.length;
  if (semEstoque > 0) {
    console.log(`[TRIER] Removidos ${semEstoque} produto(s) sem estoque`);
  }
  return comEstoque;
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function buscarProdutosTrierPorNome(termoBusca, limite = 20) {
  const cliente = criarCliente();
  const termoNormalizado = termoBusca.trim();

  console.log(`\n========================================`);
  console.log(`[TRIER] Buscando: "${termoNormalizado}"`);
  console.log(`========================================`);

  let produtos = [];
  let metodo = '';

  try {
    const resultadoV1 = await buscarProdutoPorNome(cliente, termoNormalizado);
    if (resultadoV1.length > 0) {
      produtos = resultadoV1;
      metodo = 'obter-v1';
    } else {
      console.log(`[TRIER] obter-v1 sem resultado, tentando obter-todos-v1...`);
      produtos = await buscarTodosProdutos(cliente, termoNormalizado);
      metodo = 'obter-todos-v1';
    }
    console.log(`[TRIER] ${metodo} retornou ${produtos.length} produto(s)`);
  } catch (erro) {
    const mensagem = descreverErroTrier(erro);
    console.error(`[TRIER] Erro na busca:`, mensagem);
    throw new Error(`Falha ao consultar API Trier: ${mensagem}`);
  }

  if (produtos.length === 0) {
    return { produtos: [], metadados: { termo_original: termoNormalizado, metodo_busca: metodo, total_bruto: 0, total_apos_filtro: 0, total_com_estoque: 0, total_enriquecido: 0 } };
  }

  // 1) Filtra por relevância textual
  const filtrados = filtrarEOrdenarPorRelevancia(produtos, termoNormalizado);

  // 2) Remove sem estoque logo aqui — antes de enriquecer (economiza requests)
  const comEstoque = filtrarComEstoque(filtrados);
  const selecionados = comEstoque.slice(0, limite);

  console.log(`[TRIER] ${produtos.length} brutos → ${filtrados.length} relevantes → ${comEstoque.length} com estoque → ${selecionados.length} para enriquecimento`);

  if (selecionados.length === 0) {
    console.warn(`[TRIER] Nenhum produto com estoque encontrado`);
    return { produtos: [], metadados: { termo_original: termoNormalizado, metodo_busca: metodo, total_bruto: produtos.length, total_apos_filtro: filtrados.length, total_com_estoque: 0, total_enriquecido: 0 } };
  }

  // 3) Enriquece sequencialmente (um por vez, 2 requests paralelos por produto)
  console.log(`[TRIER] Enriquecendo ${selecionados.length} produtos com preços...`);
  const enriquecidos = await enriquecerSequencial(cliente, selecionados);
  console.log(`[TRIER] ✅ Enriquecimento concluído`);

  return {
    produtos: enriquecidos,
    metadados: {
      termo_original: termoNormalizado,
      metodo_busca: metodo,
      total_bruto: produtos.length,
      total_apos_filtro: filtrados.length,
      total_com_estoque: comEstoque.length,
      total_enriquecido: enriquecidos.length,
    },
  };
}

export { buscarProdutosTrierPorNome, resolverMelhorPreco, calcularScoreSimilaridade };
