require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');

const app = express();
const db = new sqlite3.Database('datenbank.db');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(session({
    secret: 'Ihr geheimer Schlüssel',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');

// Middleware zum Überprüfen, ob der Benutzer eingeloggt ist
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Tabelle für Benutzer erstellen (mit Feld für letzten Login)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        password TEXT,
        last_login DATETIME
    )`);
});

// Tabelle für Positionen erstellen
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        symbol TEXT,
        name TEXT,
        purchase_price REAL,
        quantity INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Startseite ist die Registrierungsseite
app.get('/', (req, res) => {
    res.redirect('/register');
});

app.get('/register', (req, res) => {
    const error = req.query.error;
    res.send(`
        <h1>Registrierung</h1>
        <form method="POST" action="/register">
            <label>Benutzername:</label><br>
            <input type="text" name="username" required><br>
            <label>Passwort:</label><br>
            <input type="password" name="password" required><br><br>
            <input type="submit" value="Registrieren">
        </form>
        ${error ? `<p style="color:red;">${error}</p>` : ''}
        <p>Bereits registriert? <a href="/login">Hier anmelden</a></p>
    `);
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user) {
            return res.redirect('/register?error=Benutzername bereits vergeben.');
        }
        // Asynchrones Hashing des Passworts
        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                console.error(err);
                return res.send('Ein Fehler ist aufgetreten.');
            }
            db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
                if (err) {
                    console.error(err);
                    return res.send('Ein Fehler ist aufgetreten.');
                }
                res.redirect('/login');
            });
        });
    });
});

app.get('/login', (req, res) => {
    const error = req.query.error;
    res.send(`
        <h1>Anmeldung</h1>
        <form method="POST" action="/login">
            <label>Benutzername:</label><br>
            <input type="text" name="username" required><br>
            <label>Passwort:</label><br>
            <input type="password" name="password" required><br><br>
            <input type="submit" value="Anmelden">
        </form>
        ${error ? `<p style="color:red;">${error}</p>` : ''}
        <p>Noch nicht registriert? <a href="/register">Jetzt registrieren</a></p>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) {
            console.error(err);
            res.redirect('/login?error=Fehler bei der Anmeldung.');
        } else if (!user) {
            res.redirect('/login?error=Ungültige Anmeldedaten.');
        } else {
            bcrypt.compare(password, user.password, (err, result) => {
                if (result) {
                    req.session.userId = user.id;
                    res.redirect('/portfolio'); // Benutzer zur Portfolioseite weiterleiten
                } else {
                    res.redirect('/login?error=Ungültige Anmeldedaten.');
                }
            });
        }
    });
});

app.get('/hauptseite', requireLogin, (req, res) => {
    res.send(`
        <h1>Willkommen, Benutzer ${req.session.userId}!</h1>
        <p>Dies ist die Hauptseite.</p>
        <a href="/logout">Abmelden</a>
    `);
});

// Route zum Anzeigen des Portfolios anpassen
app.get('/portfolio', isAuthenticated, async (req, res) => {
    try {
        const positions = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM positions WHERE user_id = ?`, [req.session.userId], (err, positions) => {
                if (err) reject(err);
                else resolve(positions);
            });
        });

        for (const position of positions) {
            try {
                position.currentPrice = await getCurrentPrice(position.symbol);
            } catch (error) {
                console.error(`Fehler beim Abrufen des Preises für ${position.symbol}:`, error);
                position.currentPrice = 0;
            }
        }

        res.render('portfolio.ejs', { positions: positions });
    } catch (error) {
        console.error('Fehler beim Laden des Portfolios:', error);
        res.send('Fehler beim Laden des Portfolios');
    }
});

// Route zum Löschen einer Position hinzufügen
app.post('/deletePosition', isAuthenticated, (req, res) => {
    const { id } = req.body;
    db.run(`DELETE FROM positions WHERE id = ? AND user_id = ?`, [id, req.session.userId], function(err) {
        if (err) {
            console.error(err);
            res.send('Fehler beim Löschen der Position');
        } else {
            res.redirect('/portfolio');
        }
    });
});

// Route zum Hinzufügen einer Position
app.post('/addPosition', isAuthenticated,  (req, res) => {
    const { symbol, name, purchase_price, quantity } = req.body;
    db.run(`INSERT INTO positions (user_id, symbol,   name,    purchase_price, quantity) VALUES (?, ?, ?, ?, ?)`,
        [req.session.userId, symbol, name, purchase_price, quantity],
        function(err) {
            if (err) {
                console.error(err);
                res.send('Fehler beim Hinzufügen der Position');
            } else {
                res.redirect('/portfolio');
            }
        }
    );
});

// Funktion zum Abrufen des aktuellen Preises mit der Polygon API
async function getCurrentPrice(symbol) {
    const apiKey = process.env.POLYGON_API_KEY;
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log(data); // Debugging

        if (data && data.results && data.results.length > 0) {
            const closePrice = data.results[0].c; // Schlusskurs
            return closePrice;
        } else {
            throw new Error('Keine Preisdaten verfügbar');
        }
    } catch (error) {
        console.error('API Fehler:', error);
        throw error;
    }
}

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.send('Fehler beim Abmelden.');
        }
        res.redirect('/login');
    });
});

app.listen(3000, () => {
    console.log('Server läuft auf Port 3000');
});