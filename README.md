# Appunti 5IB Zuccante

## Backend PHP e database SQLite

Il frontend (`index.html`, `script.js`, `style.css`) mantiene grafica e flussi esistenti. L’API ora è in `server.php`; lo schema del database è in `database.sql`. Servono PHP 8.1 o successivo con `pdo_sqlite` e `curl`:

```sh
sudo apt update
sudo apt install php-cli php-sqlite3 php-curl sqlite3
php -m | grep -E 'PDO|pdo_sqlite|curl'
```

Configura i segreti una sola volta:

```sh
cp .env.example .env
nano .env
chmod 600 .env
```

Inserisci il token e l’ID del database Notion in `.env`. Il file è escluso da Git; PHP lo legge senza dipendenze Composer e le variabili impostate nel processo hanno la precedenza.

Avvio locale da terminale:

```sh
php -S 127.0.0.1:8000 server.php
```

Apri `http://127.0.0.1:8000`. `COOKIE_SECURE=false` nel file di esempio vale solo per HTTP locale. In produzione servi sito e `/api/` dallo stesso dominio HTTPS tramite Nginx e PHP-FPM; inoltra `Host`, imposta `X-Forwarded-Proto` al protocollo pubblico e sovrascrivi `X-Forwarded-For` con l’indirizzo client. Nginx deve inoltrare `server.php` a PHP-FPM e negare l’accesso a `/.private/`, `/.git/` e ai file `.sqlite`, `.db`, `.json` e `.csv`. Non disattivare `Secure` in produzione. Il server PHP integrato serve direttamente solo CSS, JavaScript e immagini.

Il file `.private/appunti.sqlite` viene creato al primo avvio in una cartella con permessi `0700`; il file usa `0600`. Puoi cambiare percorso con `SQLITE_FILE`, mantenendolo fuori dalla root pubblica del sito. Le tabelle SQL contengono utenti, sessioni, permessi per nota/materia, tentativi di accesso e cache Notion. Password e sessioni sono hash nel database; i cookie sono `HttpOnly`, `SameSite=Strict` e validi sette giorni.

## I 23 account

Gli account del registro in `5IB.png` sono già stati inseriti in `.private/appunti.sqlite`. Gli username sono i cognomi in minuscolo; i cognomi composti usano il trattino. `tonini` è l’unico superutente. Gli altri account sono utenti normali. Tutti devono cambiare la password al primo accesso, prima di poter aprire note o materie.

Username: `bashar`, `batista`, `brusegan`, `busetto`, `canziani`, `cotelea`, `della-ratta`, `di-battista`, `don`, `guerra`, `giuglielmi`, `guo`, `isandelli`, `lghoul`, `maestri`, `mauriello`, `morettin`, `roibu`, `rossi`, `tonini`, `yasashiniy`, `zambelli`, `zhang`.

Le password temporanee sono nel file ignorato da Git `password-temporanee-5ib.csv` (permessi `0600`). Consegnale singolarmente e privatamente, poi elimina il CSV. Se il database viene creato su un’installazione nuova senza il CSV, PHP genera credenziali nuove in `password-temporanee-php.csv`.

## Gestione da terminale

Elenca utenti, ruoli e stato della password:

```sh
php manage-accounts.php list
```

Reimposta la password di un account dimenticata:

```sh
php manage-accounts.php reset mauriello
```

Il comando revoca le sessioni esistenti e salva una password temporanea in `.private/password-reset-mauriello.txt` con permessi `0600`; consegnala privatamente e cancella il file dopo l’uso.

Puoi interrogare SQLite direttamente:

```sh
sqlite3 .private/appunti.sqlite '.tables'
sqlite3 .private/appunti.sqlite 'SELECT username, name, role, must_change_password FROM users ORDER BY username;'
```

Per fare un backup consistente mentre il server è acceso:

```sh
sqlite3 .private/appunti.sqlite ".backup 'appunti-backup.sqlite'"
chmod 600 appunti-backup.sqlite
```

Conserva backup e file delle password fuori dal repository e proteggili. Per assegnare la visibilità delle note e delle materie usa **Gestisci visibilità** nel sito con l’account `tonini`; una regola assente significa che tutti gli utenti autenticati possono visualizzare l’elemento.

## Migrazione dei dati precedenti

Il database SQLite già creato conserva i 23 username e le password temporanee generate in precedenza. In altre installazioni, quando SQLite è vuoto, `server.php` importa automaticamente account e permessi da `accounts.json`; se non trova le password temporanee locali ne genera di nuove e le salva nel CSV privato PHP.
