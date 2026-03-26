import express from 'express';
import { PORT } from './src/config/env.js';
import { router } from './src/routes/buscaRoutes.js';

const app = express();
app.use(express.json());
app.use(router);

app.listen(PORT, () => {
  console.log(`Servidor Trier Integration rodando na porta ${PORT}`);
});
