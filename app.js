const express = require('express');
const { PORT } = require('./src/config/env');

const { router } = require('./src/routes/buscaRoutes');

const app = express();
app.use(express.json());
app.use(router);

app.listen(PORT, () => {
  console.log(`Servidor Trier Integration rodando na porta ${PORT}`);
});
