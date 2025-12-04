require('dotenv').config();

const express = require('express');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const { Pool } = require('pg');

const program = new Command();

program
  .requiredOption('-h, --host <host>', 'Server host')
  .requiredOption('-p, --port <port>', 'Server port')
  .requiredOption('-c, --cache <path>', 'Cache directory path');

program.parse(process.argv);
const options = program.opts();

// Створення папки кешу, якщо не існує
if (!fs.existsSync(options.cache)) {
    fs.mkdirSync(options.cache, { recursive: true });
}

// Налаштування підключення до БД з змінних середовища
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, options.cache);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

app.post('/register', upload.single('photo'), async (req, res) => {
    const { inventory_name, description } = req.body;
    if (!inventory_name) {
        return res.status(400).send('Bad Request: inventory_name is required');
    }

    const photo = req.file ? req.file.filename : null;

    try {
        await pool.query(
            'INSERT INTO items (name, description, photo) VALUES ($1, $2, $3)',
            [inventory_name, description, photo]
        );
        res.status(201).send('Created');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/inventory/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('Not found');
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.put('/inventory/:id', async (req, res) => {
    const { name, description } = req.body;

    try {
        const check = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
        if (check.rows.length === 0) {
            return res.status(404).send('Not found');
        }

        await pool.query(
            'UPDATE items SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3',
            [name, description, req.params.id]
        );

        res.status(200).send('Updated');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.delete('/inventory/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);

        if (result.rowCount === 0) {
            return res.status(404).send('Not found');
        }

        res.status(200).send('Deleted');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/inventory/:id/photo', async (req, res) => {
    try {
        const result = await pool.query('SELECT photo FROM items WHERE id = $1', [req.params.id]);

        if (result.rows.length === 0 || !result.rows[0].photo) {
            return res.status(404).send('Not found');
        }

        res.sendFile(path.join(__dirname, options.cache, result.rows[0].photo));
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/search', async (req, res) => {
    const { id, includePhoto } = req.body;

    try {
        const result = await pool.query('SELECT * FROM items WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).send('Not Found');
        }

        let item = result.rows[0];
        let responseData = { ...item };

        if (includePhoto === 'on' && item.photo) {
             responseData.description = (responseData.description || '') + ` (Photo: /inventory/${item.id}/photo)`;
        }

        res.json(responseData);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error or Invalid ID format');
    }
});

const swaggerDocument = YAML.load('./swagger.yaml');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.listen(options.port, options.host, () => {
    console.log(`Server running at http://${options.host}:${options.port} (DEV MODE)`);
});