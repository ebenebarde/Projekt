const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const db = new sqlite3.Database('datenbank.db');

app.use(bodyParser.urlencoded({ extended: false }));

app.use(session({
    secret: 'Ihr geheimer Schlüssel',
    resave: false,
    saveUninitialized: true
}));

// Tabelle für Benutzer erstellen (mit Feld für letzten Login)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        password TEXT,
        last_login DATETIME
    )`);
});

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        res.redirect('/login');
    } else {
        next();
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

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) {
            console.error(err);
            return res.send('Ein Fehler ist aufgetreten.');
        }
        if (!user) {
            return res.send('Benutzer nicht gefunden.');
        }
        // Asynchroner Passwortvergleich
        bcrypt.compare(password, user.password, (err, result) => {
            if (err) {
                console.error(err);
                return res.send('Ein Fehler ist aufgetreten.');
            }
            if (result) {
                // Passwörter stimmen überein
                req.session.userId = user.id;
                // Letzten Login-Zeitpunkt speichern
                const loginTime = new Date().toISOString();
                db.run("UPDATE users SET last_login = ? WHERE id = ?", [loginTime, user.id], (err) => {
                    if (err) {
                        console.error(err);
                    }
                    res.redirect('/hauptseite');
                });
            } else {
                // Passwort stimmt nicht
                res.send('Ungültige Anmeldedaten.');
            }
        });
    });
});

app.get('/hauptseite', requireLogin, (req, res) => {
    res.send(`
        <h1>Willkommen, Benutzer ${req.session.userId}!</h1>
        <p>Dies ist die Hauptseite.</p>
        <a href="/logout">Abmelden</a>
    `);
});

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