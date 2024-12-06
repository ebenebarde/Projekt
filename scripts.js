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
app.use(express.static('public')); // Statische Dateien aus dem 'public' Verzeichnis bereitstellen

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
    res.render('register.ejs', { error: error });
});

app.post('/register', (req, res) => {
    const { username, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.redirect('/register?error=Passwörter stimmen nicht überein.');
    }

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
    res.render('login.ejs', { error: error });
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

        let apiErrors = [];
        for (const position of positions) {
            try {
                position.currentPrice = await getCurrentPrice(position.symbol);
            } catch (error) {
                console.error(`Fehler beim Abrufen des Preises für ${position.symbol}:`, error);
                position.currentPrice = 0;
                apiErrors.push(`Fehler beim Abrufen des Preises für ${position.symbol}`);
            }
        }

        const message = req.query.message;
        const error = req.query.error;

        res.render('portfolio.ejs', { positions, message, error, apiErrors });
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
app.post('/addPosition', isAuthenticated, (req, res) => {
    let { symbol, name, purchase_price, quantity } = req.body;

    if (!symbol || !name || !purchase_price || !quantity) {
        return res.redirect('/portfolio?error=Alle Felder müssen ausgefüllt werden.');
    }

    purchase_price = parseFloat(purchase_price);
    quantity = parseInt(quantity);

    if (isNaN(purchase_price) || isNaN(quantity) || quantity <= 0 || purchase_price <= 0) {
        return res.redirect('/portfolio?error=Ungültige Eingabedaten.');
    }

    db.run(`INSERT INTO positions (user_id, symbol, name, purchase_price, quantity) VALUES (?, ?, ?, ?, ?)`,
        [req.session.userId, symbol, name, purchase_price, quantity],
        function(err) {
            if (err) {
                console.error(err);
                res.redirect('/portfolio?error=Fehler beim Hinzufügen der Position');
            } else {
                res.redirect('/portfolio?message=Position erfolgreich hinzugefügt');
            }
        }
    );
});

// Route zum Löschen einer Position
app.post('/deletePosition', isAuthenticated, (req, res) => {
    const positionId = req.body.positionId;
    const userId = req.session.userId;

    db.run(`DELETE FROM positions WHERE id = ? AND user_id = ?`, [positionId, userId], function(err) {
        if (err) {
            console.error(err);
            res.redirect('/portfolio?error=Fehler beim Löschen der Position');
        } else {
            res.redirect('/portfolio?message=Position erfolgreich gelöscht');
        }
    });
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