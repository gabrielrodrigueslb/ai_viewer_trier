#!/bin/bash
# Teste rápido da API de busca Trier
# Uso: ./test-local-busca.sh "gastrol"
# Uso com debug raw: ./test-local-busca.sh "gastrol" --raw

QUERY="${1:-dipirona}"
RAW="${2:-}"

PORT_PADRAO="5232"
PORT_ARQUIVO="$PORT_PADRAO"

ler_port_do_arquivo() {
  local arquivo="$1"
  if [ ! -f "$arquivo" ]; then
    return
  fi

  local porta
  porta=$(grep -E '^PORT=' "$arquivo" | tail -n 1 | cut -d '=' -f2- | tr -d '\r')
  if [ -n "$porta" ]; then
    PORT_ARQUIVO="$porta"
  fi
}

# Replica a precedencia do app: .env, depois .env.local sobrescrevendo.
ler_port_do_arquivo ".env"
ler_port_do_arquivo ".env.local"

PORT="${PORT:-$PORT_ARQUIVO}"

echo "Buscando: $QUERY"
echo "Porta: $PORT"
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
  if [ "$HTTP_STATUS" = "000" ]; then
    echo "Falha de conexao com http://localhost:$PORT/api/buscar-medicamentos"
    echo "Verifique se o servidor esta rodando e se a porta do script bate com a configurada no app."
  else
    echo "Resposta vazia da API"
  fi
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
