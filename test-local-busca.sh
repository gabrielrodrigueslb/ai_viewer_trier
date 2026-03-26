#!/bin/bash
# Teste rápido da API de busca Trier
# Uso: ./test-local-busca.sh "gastrol"
# Uso com debug raw: ./test-local-busca.sh "gastrol" --raw

QUERY="${1:-dipirona}"
PORT="${PORT:-5232}"
RAW="${2:-}"

echo "Buscando: $QUERY"
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/buscar-medicamentos" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$QUERY\", \"limite\": 10}" \
  -w "\n__STATUS__%{http_code}")

HTTP_STATUS=$(echo "$RESPONSE" | grep '__STATUS__' | sed 's/__STATUS__//')
BODY=$(echo "$RESPONSE" | sed '/__STATUS__/d')

echo "HTTP Status: $HTTP_STATUS"
echo ""

if [ "$RAW" = "--raw" ]; then
  echo "=== Resposta bruta ==="
  echo "$BODY"
  exit 0
fi

if [ -z "$BODY" ]; then
  echo "Resposta vazia da API"
  exit 1
fi

echo "$BODY" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Resposta nao e JSON valido.');
    console.error(raw.substring(0, 1000));
    process.exit(1);
  }

  if (data.erro) {
    console.error('Erro da API:', data.erro);
    console.error('Detalhes:', data.detalhes || '');
    process.exit(1);
  }

  console.log('Metadados:', JSON.stringify(data.metadados, null, 2));
  console.log('');

  if (!data.produtos || data.produtos.length === 0) {
    console.log('Nenhum produto encontrado.');
    process.exit(0);
  }

  console.log('Produtos:');
  data.produtos.forEach(p => {
    const precos = p.precos || {};
    let precoDesc = precos.preco_final != null
      ? 'R\$ ' + Number(precos.preco_final).toFixed(2)
      : 'sem preco';
    if (precos.tem_oferta) {
      precoDesc = '[' + (precos.tipo_preco || '').toUpperCase() + '] ' + precoDesc;
      if (precos.preco_sem_desconto)
        precoDesc += ' (de R\$ ' + Number(precos.preco_sem_desconto).toFixed(2) + ')';
      if (precos.desconto_percentual)
        precoDesc += ' -' + precos.desconto_percentual + '%';
      if (precos.nome_campanha)
        precoDesc += ' | Campanha: ' + precos.nome_campanha;
    }
    console.log('  ' + p.posicao + '. [' + p.codigo + '] ' + p.nome);
    console.log('      ' + precoDesc + ' | Estoque: ' + p.estoque + ' | Lab: ' + (p.laboratorio || '-'));
  });
});
"
