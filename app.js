import dotenv from 'dotenv';
import express from 'express';

import { router } from './src/routes/buscaRoutes.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(router);

const PORT = process.env.PORT || 5232;
app.listen(PORT, () => {
  console.log(`Servidor Trier Integration rodando na porta ${PORT}`);
});
