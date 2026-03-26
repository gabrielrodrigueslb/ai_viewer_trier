# Trier Integration API

API HTTP em Node.js/Express para busca de medicamentos na Trier, enriquecimento de precos promocionais e ranqueamento opcional com OpenAI.

## Visao geral

Fluxo principal da busca:

1. Recebe uma consulta do cliente, por exemplo `dipirona gotas`.
2. Detecta preferencias de forma farmaceutica, como `gotas` ou `comprimido`.
3. Consulta a API da Trier com a busca original e, quando necessario, com termos simplificados como fallback.
4. Deduplica produtos pelo `codigo`.
5. Calcula relevancia textual usando `nome`, `nomePrincipioAtivo`, `nomeLaboratorio` e `tags`.
6. Filtra produtos sem estoque.
7. Enriquece cada item com melhor preco disponivel.
8. Opcionalmente reranqueia os resultados com OpenAI.

## Tecnologias

- Node.js com ES Modules
- Express 5
- Axios
- Dotenv
- OpenAI Chat Completions

## Requisitos

- Node.js 18+ recomendado
- Token valido da API Trier
- Chave OpenAI opcional

## Configuracao

As variaveis de ambiente sao carregadas nesta ordem:

1. `.env`
2. `.env.local` sobrescrevendo valores anteriores

Variaveis suportadas:

| Variavel | Obrigatoria | Descricao | Padrao |
| --- | --- | --- | --- |
| `PORT` | Nao | Porta HTTP da API | `5232` |
| `TRIER_BASE_URL` | Sim | Base URL da API Trier | `https://api-sgf-gateway.triersistemas.com.br/sgfpod1` |
| `TRIER_TOKEN` | Sim | Token Bearer de integracao da Trier | - |
| `OPENAI_API_KEY` | Nao | Chave para ranqueamento por IA | - |

Exemplo:

```env
PORT=5285
TRIER_BASE_URL=https://api-sgf-gateway.triersistemas.com.br/sgfpod1
TRIER_TOKEN=seu-token-aqui
OPENAI_API_KEY=sua-chave-aqui
```

## Como rodar

Instalacao:

```bash
npm install
```

Desenvolvimento:

```bash
npm run dev
```

Producao/local:

```bash
npm run start
```

## Endpoints

### `GET /`

Health check simples.

Resposta:

```json
{
  "mensagem": "API de busca Trier esta rodando!"
}
```

### `POST /api/buscar-medicamentos`

Busca medicamentos na Trier, aplica filtros de relevancia e estoque, enriquece precos e opcionalmente reranqueia os resultados com IA.

#### Body

```json
{
  "query": "dorflex gotas",
  "limite": 10
}
```

Campos:

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `query` | `string` | Sim | Texto buscado pelo usuario |
| `limite` | `number` | Nao | Quantidade maxima de produtos retornados apos filtros. Padrao: `20` |

#### Exemplo de chamada com `curl`

```bash
curl -X POST http://localhost:5285/api/buscar-medicamentos \
  -H "Content-Type: application/json" \
  -d '{"query":"dorflex gotas","limite":5}'
```

#### Exemplo de resposta `200`

```json
{
  "busca": {
    "termo_original": "dorflex gotas"
  },
  "metadados": {
    "termo_original": "dorflex gotas",
    "metodo_busca": "obter-v1",
    "busca_expandida": true,
    "termos_consultados": [
      "dorflex gotas",
      "dorflex"
    ],
    "forma_solicitada": [
      "gotas"
    ],
    "total_bruto": 8,
    "total_apos_filtro": 8,
    "total_com_estoque": 7,
    "total_enriquecido": 5,
    "total_produtos": 5,
    "ordenado_por_ia": true
  },
  "produtos": [
    {
      "posicao": 1,
      "codigo": 3385,
      "codigo_barras": 7891058021757,
      "nome": "DORFLEX GTS 20ML",
      "laboratorio": "SANOFI",
      "principio_ativo": null,
      "grupo": null,
      "departamento": null,
      "estoque": 7,
      "ativo": true,
      "precos": {
        "preco_final": 24.59,
        "preco_sem_desconto": 27.32,
        "desconto_percentual": 10,
        "tipo_preco": "promocao",
        "nome_campanha": null,
        "data_inicio_campanha": null,
        "data_fim_campanha": null,
        "tem_oferta": true
      },
      "relevancia_score": 5,
      "origem_score": "ia"
    }
  ]
}
```

#### Resposta `400`

Quando `query` nao e enviada ou e vazia:

```json
{
  "erro": "Query vazia"
}
```

#### Resposta `500`

Quando ocorre erro interno no processamento:

```json
{
  "erro": "Erro ao processar busca",
  "detalhes": "Falha ao consultar API Trier: ..."
}
```

## Como a busca funciona

### 1. Busca expandida

Se a Trier nao retorna resultados para o termo completo, a API tenta termos simplificados.

Exemplo:

- Entrada: `dipirona gotas`
- Tentativas:
  - `dipirona gotas`
  - `dipirona`

Esses termos aparecem em `metadados.termos_consultados`.

### 2. Formas farmaceuticas

Atualmente a busca reconhece:

- `gota`, `gotas`, `gts`
- `comprimido`, `comprimidos`, `cp`, `cps`, `cpr`, `capsula`, `caps`, `dragea`

Regras atuais:

- Produtos com correspondencia forte de forma recebem bonus de score.
- Produtos liquidos como `LIQ`, `SOLUCAO`, `ML` podem ser tratados como compatibilidade suave para buscas de `gotas`.
- Produtos conflitantes, como comprimidos em uma busca por gotas, recebem penalidade, mas ainda podem aparecer como fallback.

### 3. Score textual

O score considera:

- `nome`
- `nomePrincipioAtivo`
- `nomeLaboratorio`
- `tags`

### 4. Estoque

Produtos sem estoque sao removidos antes do enriquecimento de preco.

### 5. Preco final

Prioridade usada para resolver o preco:

1. `encarte`
2. `promocao`
3. `desconto_cadastrado`
4. `venda`

## Ranqueamento por IA

O ranqueamento com OpenAI e opcional.

Quando `OPENAI_API_KEY` esta configurada e ha mais de um produto:

- a API envia ate 20 produtos para a OpenAI
- a IA devolve apenas a ordem dos indices
- o campo `metadados.ordenado_por_ia` vem como `true`
- `relevancia_score` passa a refletir a ordem final

Quando a chave nao esta configurada ou ocorre erro:

- a resposta continua funcionando
- a ordenacao textual e mantida
- `metadados.ordenado_por_ia` vem como `false`

## Script de teste local

O projeto inclui um script bash de teste:

```bash
./test-local-busca.sh "dipirona gotas"
```

Modo bruto:

```bash
./test-local-busca.sh "dipirona gotas" --raw
```

O script:

- usa a porta de `.env` e `.env.local`
- chama `POST /api/buscar-medicamentos`
- imprime status HTTP, metadados e lista de produtos

## Logs e comportamento esperado

Logs principais:

- `[BUSCA]` inicio do request HTTP
- `[TRIER]` chamadas e estrategia de busca
- `[IA]` ranqueamento com OpenAI
- `[RESULTADO]` resumo final do retorno

Observacao importante:

- o endpoint de encarte da Trier pode responder `500` para alguns produtos
- isso nao interrompe a busca principal
- nesses casos a API segue usando outras fontes de preco

## Estrutura da resposta

### `busca`

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `termo_original` | `string` | Query enviada pelo cliente |

### `metadados`

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `termo_original` | `string` | Query original |
| `metodo_busca` | `string` | Metodo Trier usado na primeira consulta com resultado |
| `busca_expandida` | `boolean` | Indica se houve fallback para termos simplificados |
| `termos_consultados` | `string[]` | Lista de termos tentados na Trier |
| `forma_solicitada` | `string[]` | Formas detectadas na query |
| `total_bruto` | `number` | Total consolidado antes de filtros |
| `total_apos_filtro` | `number` | Total apos score textual |
| `total_com_estoque` | `number` | Total apos filtro de estoque |
| `total_enriquecido` | `number` | Total apos enriquecimento de preco |
| `total_produtos` | `number` | Total devolvido ao cliente |
| `ordenado_por_ia` | `boolean` | Indica se a ordenacao final veio da OpenAI |

### `produtos[]`

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `posicao` | `number` | Posicao final no ranking |
| `codigo` | `number` | Codigo interno do produto na Trier |
| `codigo_barras` | `string\|number\|null` | Codigo de barras |
| `nome` | `string` | Nome do produto |
| `laboratorio` | `string\|null` | Laboratorio |
| `principio_ativo` | `string\|null` | Principio ativo |
| `grupo` | `string\|null` | Grupo |
| `departamento` | `string\|null` | Departamento |
| `estoque` | `number` | Quantidade em estoque |
| `ativo` | `boolean` | Indicador de produto ativo |
| `precos` | `object` | Informacoes de preco resolvido |
| `relevancia_score` | `number\|null` | Score final de relevancia |
| `origem_score` | `string` | `textual` ou `ia` |

## OpenAPI

Existe uma especificacao OpenAPI em [docs/openapi.yaml](docs/openapi.yaml).

## Proximos passos sugeridos

- adicionar autenticacao HTTP se a API for exposta fora da rede interna
- criar endpoint de health check com status detalhado
- expor documentacao via Swagger UI, se necessario
