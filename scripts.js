const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');

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
app.get('/portfolio', requireLogin, (req, res) => {
    db.all(`SELECT * FROM positions WHERE user_id = ?`, [req.session.userId], (err, positions) => {
        if (err) {
            console.error(err);
            res.send('Fehler beim Laden des Portfolios');
        } else {
            let completedRequests = 0;
            if (positions.length === 0) {
                res.render('portfolio.ejs', { positions: [] });
            } else {
                positions.forEach((position, index) => {
                    let stockDollarValue = getCurrentPrice(position.symbol)

                    console.log(stockDollarValue);
                    
                    /*if (err) {
                        console.error(err);
                        positions[index].currentPrice = 0;
                    } else {
                        positions[index].currentPrice = price;
                    }
                    completedRequests++;
                    if (completedRequests === positions.length) {
                        res.render('portfolio.ejs', { positions: positions });
                    }*/
                });
            }
        }
    });
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
function getCurrentPrice(symbol) {
    (async () => {
        const url = 'https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/history?symbol='+symbol+'&interval=5m&diffandsplits=false';
        const options = {
            method: 'GET',
            headers: {
                'x-rapidapi-key': 'bfc13c9f57mshcbf4aa4dfe2cdf1p109658jsn43aa4ff58622',
                'x-rapidapi-host': 'yahoo-finance15.p.rapidapi.com'
            }
        };

        try {
            const response = await fetch(url, options);
            const result = await response.text();

            const regex = /"regularMarketPrice":([0-9]+\.[0-9]{2})/;
            const currentPrice = regex.exec(result);
            const stockPrice = currentPrice[1];

            console.log(stockPrice);
            return stockPrice;
        } catch (error) {
            console.log(error);
        }
    });
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