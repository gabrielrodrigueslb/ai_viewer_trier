<<<<<<< HEAD
const express = require('express');
const { PORT } = require('./src/config/env');
=======
import dotenv from 'dotenv';
import express from 'express';
>>>>>>> b70b1db6688f2bca94508c064fc8c4c5923b1cf5

import { router } from './src/routes/buscaRoutes.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(router);

app.listen(PORT, () => {
  console.log(`Servidor Trier Integration rodando na porta ${PORT}`);
});
