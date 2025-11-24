import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import bcrypt from 'bcryptjs';

const execAsync = promisify(exec);

// Data Manager
class DataManager {
  constructor() {
    this.dataDir = './data';
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir);
  }

  async read(file) {
    try {
      return JSON.parse(await readFile(`${this.dataDir}/${file}.json`, 'utf8'));
    } catch {
      return file === 'admins' ? { admins: [process.env.MAIN_ADMIN_ID] } : {};
    }
  }

  async write(file, data) {
    await writeFile(`${this.dataDir}/${file}.json`, JSON.stringify(data, null, 2));
  }

  async getVPS(userId) {
    const data = await this.read('vps');
    return data[userId] || [];
  }

  async saveVPS(userId, vpsList) {
    const data = await this.read('vps');
    data[userId] = vpsList;
    await this.write('vps', data);
  }

  async isAdmin(userId) {
    const data = await this.read('admins');
    return data.admins.includes(userId) || userId === process.env.MAIN_ADMIN_ID;
  }

  async getUser(userId) {
    const data = await this.read('users');
    return data[userId];
  }

  async saveUser(userId, userData) {
    const data = await this.read('users');
    data[userId] = userData;
    await this.write('users', data);
  }

  async validateLogin(username, password) {
    const users = await this.read('users');
    const user = Object.values(users).find(u => u.panelUsername === username);
    return user && await bcrypt.compare(password, user.panelPassword) ? user : null;
  }
}

// KVM Manager
class KVMManager {
  async cmd(command) {
    try {
      const { stdout } = await execAsync(command);
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createVM(name, specs) {
    const diskPath = `/var/lib/libvirt/images/${name}.qcow2`;
    await this.cmd(`qemu-img create -f qcow2 ${diskPath} ${specs.disk}G`);
    
    const result = await this.cmd(`
      virt-install --name ${name} --memory ${specs.ram * 1024} --vcpus ${specs.cpu} \
      --disk path=${diskPath} --os-variant ubuntu20.04 --network network=default \
      --graphics none --noautoconsole --import
    `);

    return result;
  }

  async startVM(name) {
    return await this.cmd(`virsh start ${name}`);
  }

  async stopVM(name) {
    return await this.cmd(`virsh destroy ${name}`);
  }

  async deleteVM(name) {
    await this.stopVM(name);
    await this.cmd(`virsh undefine ${name}`);
    await this.cmd(`rm -f /var/lib/libvirt/images/${name}.qcow2`);
    return { success: true };
  }

  generatePassword() {
    return Math.random().toString(36).slice(-8);
  }
}

// Discord Bot
const data = new DataManager();
const kvm = new KVMManager();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('ready', () => {
  console.log(`✅ ${client.user.tag} ready!`);
  client.user.setActivity('Zycron VPS Manager');
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;

  const args = message.content.slice(1).split(' ');
  const command = args.shift().toLowerCase();

  try {
    if (command === 'ping') {
      await message.reply('🏓 Pong!');
    } else if (command === 'create') {
      await createVPS(message, args);
    } else if (command === 'myvps') {
      await myVPS(message);
    } else if (command === 'start') {
      await startVPS(message, args);
    } else if (command === 'stop') {
      await stopVPS(message, args);
    } else if (command === 'stats') {
      await stats(message);
    } else if (command === 'help') {
      await help(message);
    }
  } catch (error) {
    await message.reply('❌ Error: ' + error.message);
  }
});

async function createVPS(message, args) {
  if (!await data.isAdmin(message.author.id)) {
    return message.reply('❌ Admin only!');
  }

  const [ram, cpu, disk, userMention] = args;
  const target = message.mentions.users.first();
  if (!target || !ram || !cpu || !disk) {
    return message.reply('❌ Usage: `!create <ram> <cpu> <disk> @user`');
  }

  const vmName = `zycron-${target.id}-${Date.now()}`;
  const specs = { ram: +ram, cpu: +cpu, disk: +disk };

  await message.channel.send('🔄 Creating VPS...');

  // Create user if new
  let userData = await data.getUser(target.id);
  if (!userData) {
    const panelPassword = kvm.generatePassword();
    userData = {
      discordId: target.id,
      panelUsername: `user${target.id}`,
      panelPassword: await bcrypt.hash(panelPassword, 10),
      created: new Date().toISOString()
    };
    await data.saveUser(target.id, userData);
  }

  // Create VM
  const result = await kvm.createVM(vmName, specs);
  if (!result.success) {
    return message.reply('❌ VM creation failed: ' + result.error);
  }

  // Save VPS data
  const vps = {
    vmName,
    specs,
    status: 'running',
    created: new Date().toISOString()
  };

  await data.addVPS(target.id, vps);

  const embed = new EmbedBuilder()
    .setTitle('✅ VPS Created!')
    .setColor(0x00FF88)
    .addFields(
      { name: 'User', value: target.toString(), inline: true },
      { name: 'Specs', value: `${ram}GB RAM, ${cpu} CPU, ${disk}GB Disk`, inline: true },
      { name: 'Panel Access', value: `http://your-server:${process.env.PANEL_PORT || 3001}\nUser: user${target.id}\nPass: ${panelPassword}` }
    );

  await message.reply({ embeds: [embed] });
}

async function myVPS(message) {
  const vpsList = await data.getVPS(message.author.id);
  if (!vpsList.length) {
    return message.reply('❌ No VPS found. Contact admin.');
  }

  const embed = new EmbedBuilder()
    .setTitle('🖥️ Your VPS')
    .setColor(0x0099FF);

  vpsList.forEach((vps, i) => {
    embed.addFields({
      name: `VPS ${i+1}`,
      value: `**${vps.vmName}**\nStatus: ${vps.status}\nSpecs: ${vps.specs.ram}GB RAM, ${vps.specs.cpu} CPU, ${vps.specs.disk}GB Disk`,
      inline: true
    });
  });

  await message.reply({ embeds: [embed] });
}

async function startVPS(message, args) {
  const index = +args[0] - 1;
  const vpsList = await data.getVPS(message.author.id);
  const vps = vpsList[index];
  
  if (!vps) return message.reply('❌ Invalid VPS number');
  
  await message.channel.send(`🔄 Starting ${vps.vmName}...`);
  const result = await kvm.startVM(vps.vmName);
  
  if (result.success) {
    await data.updateVPS(message.author.id, index, { status: 'running' });
    await message.reply('✅ VPS started!');
  } else {
    await message.reply('❌ Start failed: ' + result.error);
  }
}

async function stopVPS(message, args) {
  const index = +args[0] - 1;
  const vpsList = await data.getVPS(message.author.id);
  const vps = vpsList[index];
  
  if (!vps) return message.reply('❌ Invalid VPS number');
  
  await message.channel.send(`🔄 Stopping ${vps.vmName}...`);
  const result = await kvm.stopVM(vps.vmName);
  
  if (result.success) {
    await data.updateVPS(message.author.id, index, { status: 'stopped' });
    await message.reply('✅ VPS stopped!');
  } else {
    await message.reply('❌ Stop failed: ' + result.error);
  }
}

async function stats(message) {
  if (!await data.isAdmin(message.author.id)) {
    return message.reply('❌ Admin only!');
  }

  const vpsData = await data.read('vps');
  const totalVPS = Object.values(vpsData).reduce((sum, list) => sum + list.length, 0);
  const totalUsers = Object.keys(vpsData).length;

  const embed = new EmbedBuilder()
    .setTitle('📊 Server Stats')
    .setColor(0x0099FF)
    .addFields(
      { name: 'Total Users', value: totalUsers.toString(), inline: true },
      { name: 'Total VPS', value: totalVPS.toString(), inline: true }
    );

  await message.reply({ embeds: [embed] });
}

async function help(message) {
  const isAdmin = await data.isAdmin(message.author.id);
  const embed = new EmbedBuilder()
    .setTitle('❓ Zycron Help')
    .setColor(0x0099FF)
    .addFields(
      { name: 'User Commands', value: '`!myvps` - List VPS\n`!start <num>` - Start VPS\n`!stop <num>` - Stop VPS' }
    );

  if (isAdmin) {
    embed.addFields(
      { name: 'Admin Commands', value: '`!create <ram> <cpu> <disk> @user` - Create VPS\n`!stats` - Server stats' }
    );
  }

  await message.reply({ embeds: [embed] });
}

// Add missing method to DataManager
DataManager.prototype.addVPS = async function(userId, vps) {
  const vpsList = await this.getVPS(userId);
  vpsList.push(vps);
  await this.saveVPS(userId, vpsList);
};

DataManager.prototype.updateVPS = async function(userId, index, updates) {
  const vpsList = await this.getVPS(userId);
  if (vpsList[index]) {
    Object.assign(vpsList[index], updates);
    await this.saveVPS(userId, vpsList);
    return true;
  }
  return false;
};

client.login(process.env.DISCORD_TOKEN);
