const express = require('express');
const cors = require('cors');
const { Client } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Configuração da conexão com o PostgreSQL
const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'hype_store_db',
  password: '123456',
  port: 5432,
});

// Conecta ao banco de dados e cria tabelas se não existirem
async function initializeDatabase() {
  try {
    await client.connect();
    console.log('Conectado ao PostgreSQL');

    // Criação das tabelas
    await client.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        nome_cliente VARCHAR(100) NOT NULL,
        endereco_cliente TEXT NOT NULL,
        telefone_cliente VARCHAR(20) NOT NULL,
        mensagem_cliente TEXT,
        total DECIMAL(10, 2) NOT NULL,
        data_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pendente'
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos_pedido (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER REFERENCES pedidos(id),
        produto_nome VARCHAR(100) NOT NULL,
        produto_preco DECIMAL(10, 2) NOT NULL,
        quantidade INTEGER NOT NULL
      );
    `);

    console.log('Tabelas verificadas/criadas com sucesso');
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
    process.exit(1);
  }
}

initializeDatabase();

// Rota para confirmar pedido
app.post('/confirmar-pedido', async (req, res) => {
  const { nome_cliente, endereco_cliente, telefone_cliente, mensagem_cliente, total, produtos } = req.body;

  try {
    await client.query('BEGIN');

    // Insere o pedido principal
    const pedidoResult = await client.query(
      `INSERT INTO pedidos (nome_cliente, endereco_cliente, telefone_cliente, mensagem_cliente, total)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nome_cliente, endereco_cliente, telefone_cliente, mensagem_cliente, total]
    );

    const pedidoId = pedidoResult.rows[0].id;

    // Insere os produtos do pedido
    for (const produto of produtos) {
      await client.query(
        `INSERT INTO produtos_pedido (pedido_id, produto_nome, produto_preco, quantidade)
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, produto.nome, produto.preco, produto.quantidade || 1]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Pedido confirmado com sucesso!',
      pedidoId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao confirmar pedido:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao confirmar pedido',
      details: error.message
    });
  }
});

// Rota para listar todos os pedidos (atualizada)
app.get('/pedidos', async (req, res) => {
  try {
    const result = await client.query(`
      SELECT 
        p.id,
        p.nome_cliente,
        p.endereco_cliente,
        p.telefone_cliente,
        p.mensagem_cliente,
        p.total::float,
        p.data_pedido,
        p.status,
        COUNT(pp.id) as total_produtos,
        COALESCE(SUM(pp.produto_preco * pp.quantidade), 0)::float as valor_total
      FROM pedidos p
      LEFT JOIN produtos_pedido pp ON p.id = pp.pedido_id
      GROUP BY p.id
      ORDER BY p.data_pedido DESC
    `);
    
    // Converter todos os números para float
    const pedidos = result.rows.map(pedido => ({
      ...pedido,
      total: parseFloat(pedido.total),
      valor_total: parseFloat(pedido.valor_total)
    }));
    
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao buscar pedidos:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar pedidos',
      details: error.message 
    });
  }
});

// Rota para buscar detalhes de um pedido
app.get('/pedidos/:id', async (req, res) => {
  try {
    const pedidoId = req.params.id;
    
    const pedidoResult = await client.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    if (pedidoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    
    const produtosResult = await client.query(
      'SELECT * FROM produtos_pedido WHERE pedido_id = $1', 
      [pedidoId]
    );
    
    res.json({
      pedido: pedidoResult.rows[0],
      produtos: produtosResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar pedido:', error);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  }
});

// Rota para atualizar status do pedido
app.put('/pedidos/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const result = await client.query(
      'UPDATE pedidos SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// Rota para relatório de vendas (atualizada)
app.get('/relatorios/vendas', async (req, res) => {
  try {
    const result = await client.query(`
      SELECT 
        COALESCE(SUM(total), 0) as total_vendas,
        COUNT(id) as total_pedidos,
        CASE WHEN COUNT(id) > 0 THEN COALESCE(AVG(total), 0) ELSE 0 END as media_pedido
      FROM pedidos
      WHERE status != 'cancelado'
    `);
    
    // Garantir que os valores são números
    const relatorio = {
      total_vendas: parseFloat(result.rows[0].total_vendas) || 0,
      total_pedidos: parseInt(result.rows[0].total_pedidos) || 0,
      media_pedido: parseFloat(result.rows[0].media_pedido) || 0
    };
    
    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ 
      error: 'Erro ao gerar relatório',
      details: error.message 
    });
  }
});