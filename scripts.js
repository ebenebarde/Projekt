const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');
const $ = require('jquery');

const app = express();
const db = new sqlite3.Database('datenbank.db');

app.use(bodyParser.urlencoded({ extended: false }));

app.use(session({
    secret: 'Ihr geheimer Schlüssel',
    resave: false,
    saveUninitialized: true
}));

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
    res.send(`
        <h1>Registrierung</h1>
        <form method="POST" action="/register">
            <label>Benutzername:</label><br>
            <input type="text" name="username" required><br>
            <label>Passwort:</label><br>
            <input type="password" name="password" required><br><br>
            <input type="submit" value="Registrieren">
        </form>
        <p>Bereits registriert? <a href="/login">Hier anmelden</a></p>
    `);
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
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

app.get('/login', (req, res) => {
    res.send(`
        <h1>Anmeldung</h1>
        <form method="POST" action="/login">
            <label>Benutzername:</label><br>
            <input type="text" name="username" required><br>
            <label>Passwort:</label><br>
            <input type="password" name="password" required><br><br>
            <input type="submit" value="Anmelden">
        </form>
        <p>Noch nicht registriert? <a href="/register">Jetzt registrieren</a></p>
    `);
});

// Login-Route anpassen
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) {
            console.error(err);
            res.send('Fehler bei der Anmeldung.');
        } else if (!user) {
            res.send('Ungültige Anmeldedaten.');
        } else {
            bcrypt.compare(password, user.password, (err, result) => {
                if (result) {
                    req.session.userId = user.id;
                    res.redirect('/portfolio'); // Benutzer zur Portfolioseite weiterleiten
                } else {
                    res.send('Ungültige Anmeldedaten.');
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

// Route zum Anzeigen des Portfolios
app.get('/portfolio', requireLogin, async (req, res) => {
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

// Route zum Hinzufügen einer Position
app.post('/addPosition', isAuthenticated, (req, res) => {
    const { symbol, name, purchase_price, quantity } = req.body;
    db.run(`INSERT INTO positions (user_id, symbol, name, purchase_price, quantity) VALUES (?, ?, ?, ?, ?)`,
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

// Funktion zum Abrufen des aktuellen Preises
async function getCurrentPrice(symbol) {
    const url = `https://yahoo-finance166.p.rapidapi.com/api/stock/get-price?region=US&symbol=${symbol}`;
    const options = {
        method: 'GET',
        headers: {
            'x-rapidapi-key': '8f5be43db5mshc4337ba6dbeed08p1c801fjsnf0d72af9ebec',
            'x-rapidapi-host': 'yahoo-finance166.p.rapidapi.com'
        }
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (data && data.data && data.data.price) {
            return data.data.price;
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