const { Client } = require('pg');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Habilita CORS para qualquer origem

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});


// Configuração importante do CORS
app.use(express.json()); // Adicione esta linha
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'], // Portas do Live Server
  methods: ['GET', 'POST', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type']
}));
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
    const tables = [
      {
        name: 'produtos',
        schema: `
          id SERIAL PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          preco DECIMAL(10,2) NOT NULL,
          imagem TEXT NOT NULL,
          data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `
      },
      {
        name: 'pedidos',
        schema: `
          id SERIAL PRIMARY KEY,
          nome_cliente VARCHAR(100) NOT NULL,
          endereco_cliente TEXT NOT NULL,
          telefone_cliente VARCHAR(20) NOT NULL,
          mensagem_cliente TEXT,
          total DECIMAL(10, 2) NOT NULL,
          data_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status VARCHAR(20) DEFAULT 'pendente'
        `
      },
      {
        name: 'produtos_pedido',
        schema: `
          id SERIAL PRIMARY KEY,
          pedido_id INTEGER REFERENCES pedidos(id),
          produto_nome VARCHAR(100) NOT NULL,
          produto_preco DECIMAL(10,2) NOT NULL,
          quantidade INTEGER NOT NULL DEFAULT 1
        `
      }
    ];
    for (const table of tables) {
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${table.name} (${table.schema});
        `);
        console.log(`Tabela ${table.name} verificada/criada`);
      } catch (error) {
        if (error.code === '42P07') {
          console.log(`Tabela ${table.name} já existe`);
        } else {
          throw error;
        }
      }
    }

    console.log('Todas tabelas verificadas com sucesso');
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
    process.exit(1);
  }
}

initializeDatabase();

// Rota para cadastrar produto
app.post('/produtos', async (req, res) => {
  try {
    const { nome, preco, imagem } = req.body;
    
    // Validação robusta
    if (!nome || typeof nome !== 'string') {
      return res.status(400).json({ error: 'Nome do produto inválido' });
    }
    
    const precoNum = parseFloat(preco);
    if (isNaN(precoNum)) {
      return res.status(400).json({ error: 'Preço inválido' });
    }

    if (!imagem || typeof imagem !== 'string') {
      return res.status(400).json({ error: 'URL da imagem inválida' });
    }

    const result = await client.query(
      `INSERT INTO produtos (nome, preco, imagem) 
       VALUES ($1, $2, $3) RETURNING *`,
      [nome, precoNum, imagem]
    );

    res.status(201).json(result.rows[0]);
    
  } catch (error) {
    console.error('Erro no cadastro:', error);
    res.status(500).json({ 
      error: 'Erro no servidor',
      details: error.message 
    });
  }
});

// Rota para listar produtos
app.get('/produtos', async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM produtos');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// Rota para excluir produto
app.delete('/produtos/:id', async (req, res) => {
  try {
    const result = await client.query(
      'DELETE FROM produtos WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.json({
      success: true,
      message: 'Produto excluído com sucesso',
      produto: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    res.status(500).json({ error: 'Erro ao excluir produto' });
  }
});

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