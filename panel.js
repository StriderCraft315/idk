import express from 'express';
import bcrypt from 'bcryptjs';
import { readFile } from 'fs/promises';

const app = express();
const PORT = process.env.PANEL_PORT || 3001;
const sessions = new Map();

app.use(express.urlencoded({ extended: true }));

// Simple data functions
async function getData(file) {
  try {
    return JSON.parse(await readFile(`./data/${file}.json`, 'utf8'));
  } catch {
    return {};
  }
}

async function validateLogin(username, password) {
  const users = await getData('users');
  const user = Object.values(users).find(u => u.panelUsername === username);
  return user && await bcrypt.compare(password, user.panelPassword) ? user : null;
}

async function getUserVPS(userId) {
  const vpsData = await getData('vps');
  return vpsData[userId] || [];
}

// Routes
app.get('/', (req, res) => {
  const sessionId = req.query.session;
  const user = sessions.get(sessionId);
  if (!user) return res.redirect('/login');
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Zycron Panel</title>
        <style>
            body { font-family: Arial; margin: 40px; background: #1a1a1a; color: white; }
            .vps-card { background: #2d2d2d; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .btn { padding: 8px 12px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
            .start { background: #00cc66; color: white; }
            .stop { background: #ff4444; color: white; }
        </style>
    </head>
    <body>
        <h1>Welcome, ${user.panelUsername}!</h1>
        <a href="/login" style="color: #ff4444;">Logout</a>
        <h2>Your VPS</h2>
        <div id="vps-list">Loading...</div>
        <script>
            const session = '${sessionId}';
            
            async function loadVPS() {
                const vpsList = ${JSON.stringify(await getUserVPS(user.discordId))};
                const list = document.getElementById('vps-list');
                list.innerHTML = '';
                
                vpsList.forEach((vps, index) => {
                    const card = document.createElement('div');
                    card.className = 'vps-card';
                    card.innerHTML = \`
                        <h3>\${vps.vmName}</h3>
                        <p>Status: <strong>\${vps.status}</strong></p>
                        <p>Specs: \${vps.specs.ram}GB RAM, \${vps.specs.cpu} CPU, \${vps.specs.disk}GB Disk</p>
                        <button class="btn start" onclick="vpsAction(\${index}, 'start')">Start</button>
                        <button class="btn stop" onclick="vpsAction(\${index}, 'stop')">Stop</button>
                    \`;
                    list.appendChild(card);
                });
            }
            
            async function vpsAction(index, action) {
                const response = await fetch('/vps/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session, index, action })
                });
                
                const result = await response.json();
                alert(result.message);
                loadVPS();
            }
            
            loadVPS();
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

app.get('/login', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Login - Zycron</title>
        <style>
            body { font-family: Arial; margin: 100px; background: #1a1a1a; color: white; }
            .login { max-width: 300px; margin: 0 auto; }
            input, button { width: 100%; padding: 10px; margin: 5px 0; }
            .error { color: #ff4444; }
        </style>
    </head>
    <body>
        <div class="login">
            <h1>Zycron VPS Panel</h1>
            ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''}
            <form method="POST">
                <input type="text" name="username" placeholder="Username" required>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Login</button>
            </form>
        </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await validateLogin(username, password);
  
  if (user) {
    const sessionId = Math.random().toString(36).slice(2);
    sessions.set(sessionId, user);
    res.redirect(`/?session=${sessionId}`);
  } else {
    res.redirect('/login?error=Invalid credentials');
  }
});

app.post('/vps/action', express.json(), async (req, res) => {
  const { session, index, action } = req.body;
  const user = sessions.get(session);
  
  if (!user) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  const vpsList = await getUserVPS(user.discordId);
  const vps = vpsList[index];
  
  if (!vps) {
    return res.json({ success: false, error: 'VPS not found' });
  }

  // In a real implementation, you'd call kvm.startVM() or kvm.stopVM() here
  res.json({ 
    success: true, 
    message: `${action} command sent for ${vps.vmName}` 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Panel running on port ${PORT}`);
});
