const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const backup = require('discord-backup');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ]
});

const DATA_FILE = path.join(process.cwd(), 'bot_data.json');
let config = { autoroleId: null, usuariosAgurdando: [], ultimoBackupId: null };

const C = {
    reset: "\x1b[0m", bright: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m",
    blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", red: "\x1b[31m"
};

try { if (fs.existsSync(DATA_FILE)) config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch (e) {}
function saveConfig() { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); }

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    let prefix = `[${time}] [INFO] `;
    if (level === 'success') prefix = `[${time}] [${C.green}OK${C.reset}] `;
    if (level === 'warn') prefix = `[${time}] [${C.yellow}WARN${C.reset}] `;
    if (level === 'error') prefix = `[${time}] [${C.red}ERROR${C.reset}] `;
    console.log(`${prefix}${message}`);
}

async function enviarDM(titulo, mensagem, cor) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder()
            .setColor(cor || '#2C2A4A')
            .setTitle(titulo)
            .setDescription(mensagem)
            .setTimestamp()
            .setFooter({ text: 'NaniBot v2.4.1 • Sistema de Logs' });
        await owner.send({ embeds: [embed] });
    } catch (e) {
        console.log(`[DM] Falha ao enviar DM: ${e.message}`);
    }
}

const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('NaniBot online');
}).listen(PORT);

console.log(`NaniBot v2.4.1 iniciando...`);
terminalLog('info', 'Iniciando NaniBot em modo 24h...');

if (!TOKEN) {
    terminalLog('error', 'DISCORD_TOKEN nao configurado!');
    process.exit(1);
}

client.login(TOKEN).catch(err => {
    terminalLog('error', `Erro de login: ${err.message}`);
    process.exit(1);
});

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
    await enviarDM('✅ NaniBot Online', `Bot online!\n\n**Tag:** \`${client.user.tag}\`\n**Servidores:** \`${client.guilds.cache.size}\``, '#2C2A4A');

    const commands = [
        new SlashCommandBuilder().setName('autorole').setDescription('Define cargo automatico.').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)),
        new SlashCommandBuilder().setName('setup-server').setDescription('Monta a infraestrutura gotica blindada.'),
        new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')),
        new SlashCommandBuilder().setName('mute').setDescription('Silencia um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('tempo').setDescription('Tempo em minutos').setRequired(true)),
        new SlashCommandBuilder().setName('limpar').setDescription('Deleta mensagens.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true)),
        new SlashCommandBuilder().setName('apelido').setDescription('Altera apelido.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('novo-apelido').setDescription('Novo apelido')),
        new SlashCommandBuilder().setName('salvar-servidor').setDescription('Salva backup do servidor.'),
        new SlashCommandBuilder().setName('carregar-servidor').setDescription('Restaura backup do servidor.')
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        client.guilds.cache.forEach(async (guild) => {
            try { await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }); } catch(e) {}
        });
        terminalLog('success', 'Comandos registrados!');
    } catch (e) { terminalLog('error', `Erro nos comandos: ${e.message}`); }
});

client.on('guildMemberAdd', async (member) => {
    if (config.autoroleId) {
        try {
            const role = member.guild.roles.cache.get(config.autoroleId);
            if (role) await member.roles.add(role);
        } catch (e) {}
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!oldMember.premiumSince && newMember.premiumSince) {
        const guild = newMember.guild;
        const cargoVip = guild.roles.cache.find(r => r.name === '专 VIP Member');
        const canalNero = guild.channels.cache.find(c => c.name === './/nero');
        if (cargoVip) await newMember.roles.add(cargoVip).catch(() => {});
        if (canalNero) {
            await canalNero.send({ embeds: [new EmbedBuilder().setColor('#2C2A4A').setTitle('🔮 Novo Boost!').setDescription(`${newMember} deu boost!`).setTimestamp()] });
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const { customId, member, guild } = interaction;
        if (customId === 'solicitar_verificacao') {
            if (config.usuariosAgurdando?.includes(member.id)) return interaction.reply({ content: 'Pedido ja enviado.', ephemeral: true });
            const canalLogs = guild.channels.cache.find(c => c.name === 'staff-gate');
            if (!canalLogs) return interaction.reply({ content: 'Canal staff-gate nao encontrado.', ephemeral: true });
            if (!config.usuariosAgurdando) config.usuariosAgurdando = [];
            config.usuariosAgurdando.push(member.id); saveConfig();
            await interaction.reply({ content: '✦ Solicitacao registrada.', ephemeral: true });
            const botoesAdm = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`aprovar_${member.id}`).setLabel('✦ Permitir').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`recusar_${member.id}`).setLabel('☠ Barrar').setStyle(ButtonStyle.Danger)
            );
            await canalLogs.send({ embeds: [new EmbedBuilder().setColor('#0F0F10').setTitle('⚖️ Verificacao Pendente').setDescription(`${member} quer entrar.`).setTimestamp()], components: [botoesAdm] });
            return;
        }
        if (interaction.user.id !== guild.ownerId && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });
        if (customId.startsWith('aprovar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                const cargoMembro = guild.roles.cache.find(r => r.name === 'user');
                if (cargoMembro) await alvo.roles.add(cargoMembro);
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setTitle('✓ Acesso Liberado').setDescription(`Liberado por: ${interaction.user}`)], components: [] });
            } catch (e) { config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig(); }
        }
        if (customId.startsWith('recusar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                await alvo.kick('Barrado no Gate.');
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setTitle('☠ Barrado').setDescription(`Rejeitado por: ${interaction.user}`)], components: [] });
            } catch (e) { config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig(); }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = interaction;
    if (interaction.user.id !== guild.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Sem permissao.', ephemeral: true });

    if (commandName === 'autorole') {
        await interaction.deferReply({ ephemeral: true });
        const cargo = options.getRole('cargo');
        if (guild.members.me.roles.highest.position <= cargo.position) return interaction.editReply({ content: 'Erro de hierarquia.' });
        config.autoroleId = cargo.id; saveConfig();
        return interaction.editReply({ content: `Cargo automatico: ${cargo.name}` });
    }
    if (commandName === 'ban') {
        const alvo = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Banido por infracao.';
        try { await guild.members.ban(alvo, { reason: motivo }); return interaction.reply({ content: `⚔️ **${alvo.tag}** banido. Motivo: ${motivo}` }); }
        catch (e) { return interaction.reply({ content: 'Erro: Permissoes insuficientes.', ephemeral: true }); }
    }
    if (commandName === 'mute') {
        const alvo = options.getMember('membro');
        const tempo = options.getInteger('tempo');
        try { await alvo.timeout(tempo * 60 * 1000); return interaction.reply({ content: `⚖️ ${alvo} silenciado por ${tempo} minutos.` }); }
        catch (e) { return interaction.reply({ content: 'Erro ao silenciar.', ephemeral: true }); }
    }
    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        try { const d = await channel.bulkDelete(qtd, true); return interaction.reply({ content: `${d.size} mensagens deletadas.`, ephemeral: true }); }
        catch (e) { return interaction.reply({ content: 'Erro ao limpar.', ephemeral: true }); }
    }
    if (commandName === 'apelido') {
        const alvo = options.getMember('membro');
        const novo = options.getString('novo-apelido') || null;
        try { await alvo.setNickname(novo); return interaction.reply({ content: 'Apelido alterado.', ephemeral: true }); }
        catch (e) { return interaction.reply({ content: 'Erro de hierarquia.', ephemeral: true }); }
    }
    if (commandName === 'salvar-servidor') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const b = await backup.create(guild, { maxMessagesPerChannel: 20, jsonSave: true, jsonName: 'backup' });
            config.ultimoBackupId = b.id; saveConfig();
            return interaction.editReply({ content: `Backup criado! ID: ${b.id}` });
        } catch (e) { return interaction.editReply({ content: `Falha: ${e.message}` }); }
    }
    if (commandName === 'carregar-servidor') {
        if (!config.ultimoBackupId) return interaction.reply({ content: 'Nenhum backup salvo.', ephemeral: true });
        await interaction.reply({ content: 'Restaurando...', ephemeral: true });
        try { await backup.load(config.ultimoBackupId, guild, { clearGuildBeforeRestore: true }); }
        catch (e) { terminalLog('error', `Erro: ${e.message}`); }
    }
    if (commandName === 'setup-server') {
        if (interaction.user.id !== guild.ownerId) return interaction.reply({ content: 'Apenas o dono pode usar este comando.', ephemeral: true });
        await interaction.reply({ content: '⚙️ Montando servidor...', ephemeral: true });
        const antigos = await guild.channels.fetch();
        for (const [, c] of antigos) { try { await c.delete(); } catch(e){} }
        const cargosAntigos = await guild.roles.fetch();
        for (const [, r] of cargosAntigos) { if (!r.managed && r.id !== guild.roles.everyone.id) { try { await r.delete(); } catch(e){} } }
        await guild.roles.everyone.setPermissions([PermissionFlagsBits.ReadMessageHistory]);
        const cargoMembro = await guild.roles.create({ name: 'user', color: '#555555', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        config.autoroleId = cargoMembro.id; saveConfig();
        const cargoVip = await guild.roles.create({ name: '专 VIP Member', color: '#2C2A4A', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        const cargoDono = await guild.roles.create({ name: '👑 Server Owner', color: '#010101', hoist: true, permissions: [PermissionFlagsBits.Administrator] });
        await interaction.member.roles.add(cargoDono).catch(()=>{});
        const catPortaria = await guild.channels.create({ name: 'GATEWAY', type: ChannelType.GuildCategory });
        const canalVerificar = await guild.channels.create({ name: 'gate', type: ChannelType.GuildText, parent: catPortaria.id, permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] }, { id: cargoMembro.id, deny: [PermissionFlagsBits.ViewChannel] }] });
        await guild.channels.create({ name: 'staff-gate', type: ChannelType.GuildText, parent: catPortaria.id, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: cargoDono.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
        const catChat = await guild.channels.create({ name: 'TEXT DIRECTORY', type: ChannelType.GuildCategory });
        for (const name of ['announcements', 'sms', 'bot-commands', 'media']) {
            await guild.channels.create({ name, type: ChannelType.GuildText, parent: catChat.id, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] });
        }
        const catVoz = await guild.channels.create({ name: 'VOICE DIRECTORY', type: ChannelType.GuildCategory });
        for (const name of ['Lounge 01', 'Lounge 02']) {
            await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: catVoz.id, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }] });
        }
        const embedPortaria = new EmbedBuilder().setColor('#0A0A0A').setTitle('✦ GATEWAY INTEGRITY').setDescription('Clique abaixo para solicitar acesso.');
        const rowBotao = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('solicitar_verificacao').setLabel('✦ Request Access').setStyle(ButtonStyle.Secondary));
        await canalVerificar.send({ embeds: [embedPortaria], components: [rowBotao] });
        terminalLog('success', 'Servidor montado!');
    }
});

process.on('unhandledRejection', (error) => {
    terminalLog('error', `Erro: ${error.message}`);
    enviarDM('❌ Erro no NaniBot', `**Mensagem:** \`${error.message}\``, '#FF0000');
});
process.on('uncaughtException', (error) => {
    terminalLog('error', `Excecao: ${error.message}`);
    enviarDM('💥 Excecao Critica', `**Mensagem:** \`${error.message}\``, '#FF0000');
});
