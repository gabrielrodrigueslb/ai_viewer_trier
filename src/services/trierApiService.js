const axios = require('axios');
const { TRIER_BASE_URL, TRIER_TOKEN } = require('../config/env');

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

const STOPWORDS_BUSCA = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'para', 'com', 'sem']);

const FORMAS_FARMACEUTICAS = [
  {
    id: 'gotas',
    termosBusca: ['gota', 'gotas', 'gts'],
    regexFortes: [/\bgota\b/, /\bgotas\b/, /\bgts\b/],
    regexSuaves: [/\bliq\b/, /\bliquido\b/, /\bsol\b/, /\bsolucao\b/, /\bsusp\b/, /\bsuspensao\b/, /\bxarope\b/, /\bxpe\b/, /\bml\b/, /\b\d+ml\b/],
    regexConflito: [/\bcomprimido\b/, /\bcomprimidos\b/, /\bcp\b/, /\bcps\b/, /\bcpr\b/, /\bcprs\b/, /\b\d+cp\b/, /\b\d+cps\b/, /\bcapsula\b/, /\bcapsulas\b/, /\bcaps\b/, /\bcap\b/],
  },
  {
    id: 'comprimido',
    termosBusca: ['comprimido', 'comprimidos', 'cp', 'cps', 'cpr', 'cprs', 'capsula', 'capsulas', 'cap', 'caps', 'dragea', 'drageas'],
    regexFortes: [/\bcomprimido\b/, /\bcomprimidos\b/, /\bcp\b/, /\bcps\b/, /\bcpr\b/, /\bcprs\b/, /\b\d+cp\b/, /\b\d+cps\b/, /\bcapsula\b/, /\bcapsulas\b/, /\bcaps\b/, /\bcap\b/, /\bdragea\b/, /\bdrageas\b/],
    regexSuaves: [],
    regexConflito: [/\bgota\b/, /\bgotas\b/, /\bgts\b/, /\bliq\b/, /\bliquido\b/, /\bsol\b/, /\bsolucao\b/, /\bsusp\b/, /\bsuspensao\b/, /\bxarope\b/, /\bxpe\b/, /\bml\b/, /\b\d+ml\b/],
  },
];

const TERMOS_FORMA = new Set(FORMAS_FARMACEUTICAS.flatMap(forma => forma.termosBusca));

function montarTextoBuscaProduto(produto) {
  if (typeof produto === 'string') {
    return produto;
  }

  return [
    produto?.nome,
    produto?.nomePrincipioAtivo,
    produto?.nomeLaboratorio,
    ...(Array.isArray(produto?.tags) ? produto.tags : []),
  ]
    .filter(Boolean)
    .join(' ');
}

function calcularScoreTextoBase(textoProduto, termoBusca) {
  const produto = normalizarTexto(textoProduto);
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

function extrairPreferenciasBusca(termoBusca) {
  const termoOriginal = String(termoBusca || '').trim();
  const termoNormalizado = normalizarTexto(termoOriginal);
  const tokens = termoNormalizado.split(' ').filter(Boolean);
  const formasSolicitadas = FORMAS_FARMACEUTICAS
    .filter(forma => forma.termosBusca.some(termo => tokens.includes(termo)))
    .map(forma => forma.id);

  const tokensBase = tokens.filter(token => {
    if (STOPWORDS_BUSCA.has(token)) return false;
    if (TERMOS_FORMA.has(token)) return false;
    if (/^\d+$/.test(token)) return false;
    if (/^\d+(mg|ml|g|mcg|ui)$/i.test(token)) return false;
    return token.length >= 2;
  });

  const termoBase = tokensBase.join(' ').trim();
  const termoPrincipal = tokensBase.length > 1 ? tokensBase[0] : '';
  const termosConsulta = [];

  for (const termo of [termoOriginal, termoBase, termoPrincipal]) {
    const termoLimpo = String(termo || '').trim();
    if (!termoLimpo) continue;
    if (termosConsulta.some(item => normalizarTexto(item) === normalizarTexto(termoLimpo))) continue;
    termosConsulta.push(termoLimpo);
  }

  return {
    termoOriginal,
    termoNormalizado,
    formasSolicitadas,
    termoBase,
    termosConsulta,
  };
}

function temRegex(texto, regexes) {
  return regexes.some(regex => regex.test(texto));
}

function avaliarCompatibilidadeForma(nomeProduto, preferenciasBusca) {
  const textoProduto = normalizarTexto(nomeProduto);

  if (!textoProduto || !preferenciasBusca || preferenciasBusca.formasSolicitadas.length === 0) {
    return { bonus: 0, compatibilidade: 'neutra' };
  }

  let bonus = 0;
  let encontrouForte = false;
  let encontrouSuave = false;
  let encontrouConflito = false;

  for (const formaId of preferenciasBusca.formasSolicitadas) {
    const forma = FORMAS_FARMACEUTICAS.find(item => item.id === formaId);
    if (!forma) continue;

    if (temRegex(textoProduto, forma.regexFortes)) {
      bonus += 35;
      encontrouForte = true;
      continue;
    }

    if (temRegex(textoProduto, forma.regexSuaves)) {
      bonus += 18;
      encontrouSuave = true;
    }

    if (temRegex(textoProduto, forma.regexConflito)) {
      encontrouConflito = true;
    }
  }

  if (!encontrouForte && !encontrouSuave && encontrouConflito) {
    bonus -= 25;
  }

  return {
    bonus,
    compatibilidade: encontrouForte ? 'forte' : encontrouSuave ? 'suave' : encontrouConflito ? 'conflitante' : 'neutra',
  };
}

function calcularScoreSimilaridade(produto, termoBusca, preferenciasBusca = extrairPreferenciasBusca(termoBusca)) {
  const nomeProduto = typeof produto === 'string' ? produto : produto?.nome;
  const textoBuscaProduto = montarTextoBuscaProduto(produto);
  const scoreOriginal = calcularScoreTextoBase(textoBuscaProduto, termoBusca);
  const scoreTermoBase = preferenciasBusca.termoBase
    ? calcularScoreTextoBase(textoBuscaProduto, preferenciasBusca.termoBase)
    : 0;
  const scoreTexto = Math.max(scoreOriginal, scoreTermoBase);
  const { bonus } = avaliarCompatibilidadeForma(nomeProduto, preferenciasBusca);

  return Math.max(0, scoreTexto + bonus);
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

async function consultarProdutosPorTermo(cliente, termoConsulta) {
  const resultadoV1 = await buscarProdutoPorNome(cliente, termoConsulta);
  if (resultadoV1.length > 0) {
    return { produtos: resultadoV1, metodo: 'obter-v1', termo: termoConsulta };
  }

  console.log(`[TRIER] obter-v1 sem resultado para "${termoConsulta}", tentando obter-todos-v1...`);
  const resultadoTodos = await buscarTodosProdutos(cliente, termoConsulta);
  return { produtos: resultadoTodos, metodo: 'obter-todos-v1', termo: termoConsulta };
}

function deduplicarProdutosPorCodigo(produtos) {
  const mapa = new Map();

  for (const produto of produtos) {
    if (!produto || produto.codigo == null) continue;
    if (!mapa.has(produto.codigo)) {
      mapa.set(produto.codigo, produto);
    }
  }

  return Array.from(mapa.values());
}

function possuiProdutoCompativelComForma(produtos, preferenciasBusca) {
  if (!preferenciasBusca || preferenciasBusca.formasSolicitadas.length === 0) {
    return produtos.length > 0;
  }

  return produtos.some(produto => {
    const { compatibilidade } = avaliarCompatibilidadeForma(produto.nome, preferenciasBusca);
    return compatibilidade === 'forte' || compatibilidade === 'suave';
  });
}

async function buscarProdutosComEstrategia(cliente, preferenciasBusca) {
  const consultasRealizadas = [];
  let produtosAcumulados = [];

  for (const termoConsulta of preferenciasBusca.termosConsulta) {
    console.log(`[TRIER] Tentando termo de busca: "${termoConsulta}"`);

    const consulta = await consultarProdutosPorTermo(cliente, termoConsulta);
    consultasRealizadas.push({
      termo: consulta.termo,
      metodo: consulta.metodo,
      total: consulta.produtos.length,
    });

    produtosAcumulados = deduplicarProdutosPorCodigo([...produtosAcumulados, ...consulta.produtos]);

    if (possuiProdutoCompativelComForma(produtosAcumulados, preferenciasBusca)) {
      break;
    }
  }

  return { produtos: produtosAcumulados, consultasRealizadas };
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

function filtrarEOrdenarPorRelevancia(produtos, termoBusca, preferenciasBusca) {
  return produtos
    .map(produto => {
      const compatibilidadeForma = avaliarCompatibilidadeForma(produto.nome, preferenciasBusca);
      return {
        ...produto,
        _score: calcularScoreSimilaridade(produto, termoBusca, preferenciasBusca),
        _forma_compatibilidade: compatibilidadeForma.compatibilidade,
        _forma_bonus: compatibilidadeForma.bonus,
      };
    })
    .filter(p => p._score >= SCORE_MINIMO)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      if (b._forma_bonus !== a._forma_bonus) return b._forma_bonus - a._forma_bonus;
      return (b.quantidadeEstoque ?? 0) - (a.quantidadeEstoque ?? 0);
    });
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
  const preferenciasBusca = extrairPreferenciasBusca(termoNormalizado);

  console.log(`\n========================================`);
  console.log(`[TRIER] Buscando: "${termoNormalizado}"`);
  if (preferenciasBusca.termosConsulta.length > 1) {
    console.log(`[TRIER] Estrategia expandida: ${preferenciasBusca.termosConsulta.join(' | ')}`);
  }
  console.log(`========================================`);

  let produtos = [];
  let consultasRealizadas = [];

  try {
    const resultadoBusca = await buscarProdutosComEstrategia(cliente, preferenciasBusca);
    produtos = resultadoBusca.produtos;
    consultasRealizadas = resultadoBusca.consultasRealizadas;
    console.log(`[TRIER] Busca consolidada retornou ${produtos.length} produto(s) apos deduplicacao`);
  } catch (erro) {
    console.error(`[TRIER] Erro na busca:`, erro.message);
    throw new Error(`Falha ao consultar API Trier: ${erro.message}`);
  }

  const consultaComResultado = consultasRealizadas.find(consulta => consulta.total > 0);
  const metodoBusca = consultaComResultado?.metodo || consultasRealizadas.at(-1)?.metodo || '';

  if (produtos.length === 0) {
    return {
      produtos: [],
      metadados: {
        termo_original: termoNormalizado,
        metodo_busca: metodoBusca,
        busca_expandida: preferenciasBusca.termosConsulta.length > 1,
        termos_consultados: consultasRealizadas.map(consulta => consulta.termo),
        forma_solicitada: preferenciasBusca.formasSolicitadas,
        total_bruto: 0,
        total_apos_filtro: 0,
        total_com_estoque: 0,
        total_enriquecido: 0,
      },
    };
  }

  // 1) Filtra por relevância textual
  const filtrados = filtrarEOrdenarPorRelevancia(produtos, termoNormalizado, preferenciasBusca);

  // 2) Remove sem estoque logo aqui — antes de enriquecer (economiza requests)
  const comEstoque = filtrarComEstoque(filtrados);
  const selecionados = comEstoque.slice(0, limite);

  console.log(`[TRIER] ${produtos.length} brutos → ${filtrados.length} relevantes → ${comEstoque.length} com estoque → ${selecionados.length} para enriquecimento`);

  if (selecionados.length === 0) {
    console.warn(`[TRIER] Nenhum produto com estoque encontrado`);
    return {
      produtos: [],
      metadados: {
        termo_original: termoNormalizado,
        metodo_busca: metodoBusca,
        busca_expandida: preferenciasBusca.termosConsulta.length > 1,
        termos_consultados: consultasRealizadas.map(consulta => consulta.termo),
        forma_solicitada: preferenciasBusca.formasSolicitadas,
        total_bruto: produtos.length,
        total_apos_filtro: filtrados.length,
        total_com_estoque: 0,
        total_enriquecido: 0,
      },
    };
  }

  // 3) Enriquece sequencialmente (um por vez, 2 requests paralelos por produto)
  console.log(`[TRIER] Enriquecendo ${selecionados.length} produtos com preços...`);
  const enriquecidos = await enriquecerSequencial(cliente, selecionados);
  console.log(`[TRIER] ✅ Enriquecimento concluído`);

  return {
    produtos: enriquecidos,
    metadados: {
      termo_original: termoNormalizado,
      metodo_busca: metodoBusca,
      busca_expandida: preferenciasBusca.termosConsulta.length > 1,
      termos_consultados: consultasRealizadas.map(consulta => consulta.termo),
      forma_solicitada: preferenciasBusca.formasSolicitadas,
      total_bruto: produtos.length,
      total_apos_filtro: filtrados.length,
      total_com_estoque: comEstoque.length,
      total_enriquecido: enriquecidos.length,
    },
  };
}

module.exports = { buscarProdutosTrierPorNome, resolverMelhorPreco, calcularScoreSimilaridade };
