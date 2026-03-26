import express from 'express';
import { buscarProdutosTrierPorNome } from '../services/trierApiService.js';
import { ranquearProdutosComIA } from '../services/aiRankingService.js';

const router = express.Router();

// ─── Formatação da resposta ───────────────────────────────────────────────────

function formatarProduto(produto, posicao) {
  const p = produto.preco || {};

  return {
    posicao,
    codigo: produto.codigo,
    codigo_barras: produto.codigoBarras,
    nome: produto.nome,
    laboratorio: produto.nomeLaboratorio || null,
    principio_ativo: produto.nomePrincipioAtivo || null,
    grupo: produto.nomeGrupo || null,
    departamento: produto.nomeDepartamento || null,
    estoque: produto.quantidadeEstoque ?? 0,
    ativo: produto.ativo,
    precos: {
      preco_final: p.preco_final ?? null,
      preco_sem_desconto: p.preco_sem_desconto ?? null,
      desconto_percentual: p.desconto_percentual ?? null,
      tipo_preco: p.tipo_preco ?? null,
      nome_campanha: p.nome_campanha ?? null,
      data_inicio_campanha: p.data_inicio ?? null,
      data_fim_campanha: p.data_fim ?? null,
      tem_oferta: ['encarte', 'promocao'].includes(p.tipo_preco),
    },
    relevancia_score: produto.relevancia_score ?? produto._score ?? null,
    origem_score: produto._score != null ? 'textual' : 'ia',
  };
}

// ─── Endpoint principal ───────────────────────────────────────────────────────

router.post('/api/buscar-medicamentos', async (req, res) => {
  try {
    const { query, limite } = req.body;

    if (!query || String(query).trim() === '') {
      return res.status(400).json({ erro: 'Query vazia' });
    }

    const termoBusca = String(query).trim();
    const limiteRequisicao = Number(limite) || 20;

    console.log(`\n========================================`);
    console.log(`[BUSCA] Termo: "${termoBusca}"`);
    console.log(`[BUSCA] Limite: ${limiteRequisicao}`);
    console.log(`========================================`);

    // 1) Busca + enriquecimento de preços via Trier
    const { produtos, metadados } = await buscarProdutosTrierPorNome(termoBusca, limiteRequisicao);

    if (produtos.length === 0) {
      return res.status(200).json({
        busca: { termo_original: termoBusca },
        metadados: { ...metadados, ordenado_por_ia: false },
        produtos: [],
      });
    }

    // 2) Ranqueamento por IA
    const { produtos: ranqueados, ranqueado } = await ranquearProdutosComIA(produtos, termoBusca);

    console.log(`\n========================================`);
    console.log(`[RESULTADO] ${ranqueados.length} produto(s)`);
    console.log(`[RESULTADO] Ranqueado por IA: ${ranqueado ? 'Sim' : 'Não'}`);
    console.log(`========================================\n`);

    return res.status(200).json({
      busca: { termo_original: termoBusca },
      metadados: {
        ...metadados,
        total_produtos: ranqueados.length,
        ordenado_por_ia: ranqueado,
      },
      produtos: ranqueados.map((p, idx) => formatarProduto(p, idx + 1)),
    });
  } catch (erro) {
    console.error('❌ Erro ao buscar medicamento:', erro);
    return res.status(500).json({
      erro: 'Erro ao processar busca',
      detalhes: erro.message,
    });
  }
});

router.get('/', (req, res) => {
  res.json({ mensagem: 'API de busca Trier está rodando!' });
});

export { router };
