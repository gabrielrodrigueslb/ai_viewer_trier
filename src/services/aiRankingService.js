const axios = require('axios');
const { OPENAI_API_KEY } = require('../config/env');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_PRODUTOS_IA = 20;

// ─── Formatação para o prompt ──────────────────────────────────────────────────

function formatarPrecoProduto(produto) {
  const p = produto.preco || {};

  if (!p.preco_final) return 'sem preço';

  const final = `R$ ${Number(p.preco_final).toFixed(2)}`;

  if (p.tipo_preco === 'encarte') {
    const de = p.preco_sem_desconto ? ` (de R$ ${Number(p.preco_sem_desconto).toFixed(2)})` : '';
    return `${final}${de} — ENCARTE: ${p.nome_campanha || 'Promoção'}`;
  }

  if (p.tipo_preco === 'promocao') {
    const de = p.preco_sem_desconto ? ` (de R$ ${Number(p.preco_sem_desconto).toFixed(2)})` : '';
    const desc = p.desconto_percentual ? ` -${p.desconto_percentual}%` : '';
    return `${final}${de}${desc} — EM PROMOÇÃO`;
  }

  if (p.tipo_preco === 'desconto_cadastrado' && p.desconto_percentual) {
    const de = p.preco_sem_desconto ? ` (de R$ ${Number(p.preco_sem_desconto).toFixed(2)})` : '';
    return `${final}${de} -${p.desconto_percentual}%`;
  }

  return final;
}

function criarListaParaIA(produtos) {
  return produtos.map((p, idx) => ({
    index: idx,
    codigo: p.codigo,
    nome: (p.nome || '').substring(0, 120),
    laboratorio: p.nomeLaboratorio || '',
    principio_ativo: p.nomePrincipioAtivo || '',
    estoque: p.quantidadeEstoque ?? 0,
    preco: formatarPrecoProduto(p),
    tipo_preco: p.preco?.tipo_preco || 'venda',
    score_relevancia_texto: p._score || 0,
  }));
}

// ─── Parsing da resposta ───────────────────────────────────────────────────────

function extrairIndicesOrdenados(texto, tamanhoEsperado) {
  const limpo = String(texto || '')
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  // Aceita o array mesmo que venha com texto ao redor
  const match = limpo.match(/\[[\d,\s]+\]/);
  if (!match) throw new Error('IA não retornou array JSON válido.');

  const indices = JSON.parse(match[0]);

  // Valida se todos os índices estão no range esperado
  const validos = indices.filter(i => typeof i === 'number' && i >= 0 && i < tamanhoEsperado);

  if (validos.length !== tamanhoEsperado) {
    // Tenta completar com índices faltando (caso a IA omita alguns)
    const presentes = new Set(validos);
    const faltando = Array.from({ length: tamanhoEsperado }, (_, i) => i).filter(i => !presentes.has(i));
    const completo = [...validos, ...faltando];
    console.warn(`[IA] Índices incompletos (${validos.length}/${tamanhoEsperado}), completando com faltantes: ${faltando}`);
    return completo;
  }

  return validos;
}

// ─── Ranqueamento ──────────────────────────────────────────────────────────────

async function ranquearProdutosComIA(produtos, termoBusca) {
  console.log(`\n[IA] Ranqueando ${produtos.length} produtos para: "${termoBusca}"`);

  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'sua-chave-aqui') {
    console.log(`[IA] ⚠️ Chave não configurada — usando ordenação por score textual`);
    return { produtos, ranqueado: false };
  }

  if (produtos.length <= 1) {
    return { produtos, ranqueado: false };
  }

  const paraIA = produtos.slice(0, MAX_PRODUTOS_IA);
  const restantes = produtos.slice(MAX_PRODUTOS_IA);
  const listaProdutos = criarListaParaIA(paraIA);

  // IMPORTANTE: o prompt pede apenas ordenação — filtragem de estoque
  // já foi feita antes de chegar aqui. A IA SEMPRE retorna todos os índices.
  const prompt = `Você é especialista em produtos farmacêuticos. O cliente buscou: "${termoBusca}"

Produtos disponíveis para ordenar (${listaProdutos.length} itens, todos com estoque):
${JSON.stringify(listaProdutos, null, 2)}

Ordene do mais ao menos relevante para a busca seguindo estes critérios:
1. Maior correspondência entre a busca e o nome do produto (match exato > parcial)
2. Produtos com ENCARTE ou PROMOÇÃO ativa têm prioridade quando o match for equivalente
3. Princípio ativo compatível com a busca
4. Score de relevância textual já calculado (campo score_relevancia_texto)

REGRAS OBRIGATÓRIAS:
- Retorne APENAS um array JSON com EXATAMENTE ${listaProdutos.length} índices (0 a ${listaProdutos.length - 1})
- Todos os índices devem aparecer, sem repetição e sem omissão
- Formato: [2,0,5,1,3,4,...]
- Sem texto, explicações ou markdown`;

  try {
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é especialista em produtos farmacêuticos. Responda APENAS com um array JSON de inteiros contendo todos os índices fornecidos.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const texto = response.data.choices[0].message.content;
    console.log(`[IA] Resposta bruta: ${texto.substring(0, 100)}`);

    const indices = extrairIndicesOrdenados(texto, paraIA.length);
    const ordenados = indices.map(idx => paraIA[idx]);

    const produtosFinais = [...ordenados, ...restantes].map((p, pos, lista) => ({
      ...p,
      relevancia_score: lista.length - pos,
    }));

    console.log(`[IA] ✅ Ranqueamento concluído`);
    return { produtos: produtosFinais, ranqueado: true };
  } catch (erro) {
    console.error(`[IA] ⚠️ Erro:`, erro.message);
    return { produtos, ranqueado: false };
  }
}

module.exports = { ranquearProdutosComIA };
