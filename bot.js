const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fs = require('fs');
const path = require('path');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ]
});

const DATA_FILE = path.join(process.cwd(), 'bot_data.json');
let config = { autoroleId: null, usuariosAgurdando: [], ultimoBackupId: null, warns: {}, warnLimit: 3, logsChannelId: null, neural: { members: {} } };
const proxxySession = new Map();

const C = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m" };

try { if (fs.existsSync(DATA_FILE)) { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); config = { ...config, ...saved }; } } catch (e) {}
function saveConfig() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); } catch(e) {} }

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    const colors = { success: C.green, warn: C.yellow, error: C.red };
    const tags = { success: 'OK', warn: 'WARN', error: 'ERROR', info: 'INFO' };
    const color = colors[level] || '';
    console.log(`[${time}] [${color}${tags[level] || 'INFO'}${C.reset}] ${message}`);
}

function isOwner(userId) { return userId === OWNER_ID; }

async function enviarDM(titulo, mensagem, cor) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder().setColor(cor || '#2C2A4A').setTitle(titulo).setDescription(mensagem).setTimestamp().setFooter({ text: 'NaniBot v2.4.1 • Sistema de Logs' });
        await owner.send({ embeds: [embed] });
    } catch (e) {}
}

async function getOrCreateLogsChannel(guild) {
    if (!OWNER_ID) return null;
    if (config.logsChannelId) {
        const ch = guild.channels.cache.get(config.logsChannelId);
        if (ch) return ch;
    }
    try {
        const ch = await guild.channels.create({
            name: './/nero-logs',
            type: ChannelType.GuildText,
            topic: 'Sistema de logs privado — NaniBot Nero v2.4.1',
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: OWNER_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        config.logsChannelId = ch.id;
        saveConfig();
        return ch;
    } catch (e) { return null; }
}

async function enviarLog(guild, titulo, descricao, cor, campos) {
    try {
        const ch = await getOrCreateLogsChannel(guild);
        if (!ch) return;
        const embed = new EmbedBuilder().setColor(cor || '#2C2A4A').setTitle(titulo).setDescription(descricao).setTimestamp().setFooter({ text: 'NaniBot v2.4.1 • Nero Logs' });
        if (campos) embed.addFields(campos);
        await ch.send({ embeds: [embed] });
    } catch (e) {}
}

const PALAVROES = [
    'porra','caralho','merda','bosta','foda','foder','fodase','foda-se',
    'puta','putaria','putinha','putaxo','viado','viadao','viadão',
    'bicha','buceta','piroca','rola','cu','cuzao','cuzão',
    'tesao','tesão','safado','safada','prostituta','vadia','galinha',
    'idiota','imbecil','babaca','otario','otário','trouxa','burro','burra',
    'retardado','retardada','cretino','estupido','estúpido',
    'canalha','lixo','escoria','escória','inutil','inútil',
    'filha da puta','filho da puta','fdp','vai se foder','vsf',
    'vai tomar no cu','vtc','vtnd','pqp','krl','crl','mrd',
    'tnc','tmnc','fds','qsf','pdc','qpdc',
    'arrombado','arrombada','corno','corna',
    'maldito','maldita','desgraça','miseravel','miserável',
    'vagabundo','vagabunda','nojento','nojenta','podre',
    'boquete','cuzinho','piranha','rapariga','punheta',
    'fuder','fudendo','boceta','xota','xoxota','xana',
    'seu lixo','sua puta','vai a merda','vai à merda',
    'demonio','demônio','satanas','satanás',
    'cagao','cagão','panaca','porra louca','puta que pariu',
    'mete no cu','toma no cu','no cu','vai pro inferno',
    'anta','jumento','jumenta','lixo humano','seu merda','sua merda'
];

function trackNeural(message) {
    if (!config.neural) config.neural = { members: {} };
    const m = config.neural.members;
    const uid = message.author.id;
    if (!m[uid]) m[uid] = { tag: message.author.tag, messages: 0, mentionedBy: {}, warns: 0, deletedMsgs: 0 };
    m[uid].messages++;
    m[uid].tag = message.author.tag;
    message.mentions.users.forEach(user => {
        if (user.id === uid || user.bot) return;
        if (!m[user.id]) m[user.id] = { tag: user.tag, messages: 0, mentionedBy: {}, warns: 0, deletedMsgs: 0 };
        m[user.id].mentionedBy[uid] = (m[user.id].mentionedBy[uid] || 0) + 1;
    });
    if (m[uid].messages % 100 === 0) saveConfig();
}

function gerarRelatorioNeural(guild) {
    const m = config.neural?.members || {};
    const entries = Object.entries(m).filter(([, d]) => d.messages > 0);
    if (entries.length < 2) return null;

    const topAtivos = [...entries].sort((a, b) => b[1].messages - a[1].messages).slice(0, 5);

    const comInfluencia = entries.map(([id, d]) => {
        const total = Object.values(d.mentionedBy || {}).reduce((a, b) => a + b, 0);
        return { id, tag: d.tag, mencoes: total };
    }).sort((a, b) => b.mencoes - a.mencoes).slice(0, 5).filter(x => x.mencoes > 0);

    const pares = [];
    entries.forEach(([uid, d]) => {
        Object.entries(d.mentionedBy || {}).forEach(([de, count]) => {
            if (count >= 2 && m[de]) {
                const key = [uid, de].sort().join('|');
                const mutual = (m[uid]?.mentionedBy?.[de] || 0) + count;
                if (!pares.find(p => p.key === key)) pares.push({ key, a: uid, b: de, score: mutual });
            }
        });
    });
    pares.sort((a, b) => b.score - a.score);

    const grupos = [];
    const visitados = new Set();
    pares.forEach(par => {
        if (visitados.has(par.a) && visitados.has(par.b)) return;
        const grupo = new Set([par.a, par.b]);
        pares.forEach(p2 => { if (grupo.has(p2.a) || grupo.has(p2.b)) { grupo.add(p2.a); grupo.add(p2.b); } });
        const key = [...grupo].sort().join('-');
        if (!grupos.find(g => g.key === key)) { grupos.push({ key, membros: [...grupo] }); grupo.forEach(id => visitados.add(id)); }
    });

    const conflitos = entries.filter(([, d]) => d.warns > 0 || d.deletedMsgs > 0).sort((a, b) => (b[1].warns * 3 + b[1].deletedMsgs) - (a[1].warns * 3 + a[1].deletedMsgs)).slice(0, 5);

    return { topAtivos, comInfluencia, grupos: grupos.slice(0, 4), conflitos, total: entries.length };
}

function normalizarTexto(texto) {
    return texto.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a')
        .replace(/\$/g, 's').replace(/!/g, 'i').replace(/\+/g, 't')
        .replace(/[^a-z0-9 ]/g, '');
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('NaniBot online'); }).listen(PORT, () => { terminalLog('info', `HTTP keep-alive na porta ${PORT}`); });

console.log('NaniBot v2.4.1 iniciando...');
if (!TOKEN) { terminalLog('error', 'DISCORD_TOKEN nao configurado!'); process.exit(1); }

client.login(TOKEN).catch(err => { terminalLog('error', `Erro de login: ${err.message}`); process.exit(1); });

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
    await enviarDM('🔄 NaniBot v2.4.1 Online', `Bot atualizado e online!\n\n**Tag:** \`${client.user.tag}\`\n**Servidores:** \`${client.guilds.cache.size}\`\n**Horário:** \`${new Date().toLocaleString('pt-BR')}\``, '#2C2A4A');

    const commands = [
        new SlashCommandBuilder().setName('autorole').setDescription('Define cargo automático.').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)),
        new SlashCommandBuilder().setName('setup-server').setDescription('[OWNER] Monta a infraestrutura gótica blindada.'),
        new SlashCommandBuilder().setName('setup-logs').setDescription('[OWNER] Cria ou recria o canal de logs privado.'),
        new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')),
        new SlashCommandBuilder().setName('mute').setDescription('Silencia temporariamente.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('tempo').setDescription('Tempo em minutos').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')),
        new SlashCommandBuilder().setName('limpar').setDescription('Deleta mensagens.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true)),
        new SlashCommandBuilder().setName('apelido').setDescription('Altera apelido.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('novo-apelido').setDescription('Novo apelido')),
        new SlashCommandBuilder().setName('salvar-servidor').setDescription('[OWNER] Gera backup completo.'),
        new SlashCommandBuilder().setName('carregar-servidor').setDescription('[OWNER] Restaura o backup salvo.'),
        new SlashCommandBuilder().setName('proxxy').setDescription('[OWNER] Cria call .//Proxxy e entra nela silenciado.'),
        new SlashCommandBuilder().setName('warn').setDescription('Adiciona advertência.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
        new SlashCommandBuilder().setName('warns').setDescription('Ver advertências.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
        new SlashCommandBuilder().setName('limpar-warns').setDescription('Remove advertências.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
        new SlashCommandBuilder().setName('warn-limite').setDescription('[OWNER] Define limite de warns.').addIntegerOption(o => o.setName('numero').setDescription('Número').setRequired(true).setMinValue(1).setMaxValue(10)),
        new SlashCommandBuilder().setName('neural').setDescription('[OWNER] Exibe análise completa: panelinhas, influentes, conflitos.'),
        new SlashCommandBuilder().setName('neural-reset').setDescription('[OWNER] Apaga todos os dados coletados pelo Neural.')
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        const guildPromises = [];
        client.guilds.cache.forEach(guild => {
            guildPromises.push(rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }).catch(() => {}));
        });
        await Promise.all(guildPromises);
        terminalLog('success', 'Comandos registrados!');
    } catch (e) { terminalLog('error', `Erro nos comandos: ${e.message}`); }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    trackNeural(message);
    const textoNorm = normalizarTexto(message.content);
    const palavraoEncontrado = PALAVROES.find(p => textoNorm.includes(normalizarTexto(p)));
    if (!palavraoEncontrado) return;

    try { await message.delete(); } catch (e) {}
    if (config.neural?.members?.[message.author.id]) config.neural.members[message.author.id].deletedMsgs = (config.neural.members[message.author.id].deletedMsgs || 0) + 1;

    try {
        const embed = new EmbedBuilder()
            .setColor('#0A0A0A')
            .setTitle('⚔️ Violação de Conduta — Sistema Nero')
            .setDescription(`${message.author} ativou o sistema de punição automática.\n\n**Canal:** ${message.channel}\n**Infração:** Linguagem proibida\n**Conteúdo:** \`[CENSURADO]\`\n\n*O Nero vê tudo.*`)
            .setThumbnail(message.author.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'NaniBot v2.4.1 • Módulo de Vigilância' });
        await message.channel.send({ embeds: [embed] });
    } catch (e) {}

    await enviarLog(message.guild, '🚫 Xingamento Detectado & Deletado', `Mensagem removida pelo filtro.`, '#FF4444', [
        { name: 'Usuário', value: `${message.author} \`${message.author.tag}\``, inline: true },
        { name: 'ID', value: `\`${message.author.id}\``, inline: true },
        { name: 'Canal', value: `${message.channel}`, inline: true },
        { name: 'Conteúdo Original', value: `\`\`\`${message.content.substring(0, 500)}\`\`\`` }
    ]);
});

client.on('guildMemberAdd', async (member) => {
    if (config.autoroleId) {
        try { const role = member.guild.roles.cache.get(config.autoroleId); if (role) await member.roles.add(role); } catch (e) {}
    }
    const diasConta = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    await enviarLog(member.guild, '📥 Novo Membro Entrou', `Um novo usuário entrou no servidor.`, '#00FF88', [
        { name: 'Usuário', value: `${member} \`${member.user.tag}\``, inline: true },
        { name: 'ID', value: `\`${member.id}\``, inline: true },
        { name: 'Conta criada há', value: `\`${diasConta} dias\``, inline: true },
        { name: 'Total de Membros', value: `\`${member.guild.memberCount}\``, inline: true }
    ]);
});

client.on('guildMemberRemove', async (member) => {
    await enviarLog(member.guild, '📤 Membro Saiu do Servidor', `Um usuário saiu ou foi removido.`, '#FF8800', [
        { name: 'Usuário', value: `\`${member.user.tag}\``, inline: true },
        { name: 'ID', value: `\`${member.id}\``, inline: true },
        { name: 'Total de Membros', value: `\`${member.guild.memberCount}\``, inline: true }
    ]);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const virouBooster = !oldMember.premiumSince && newMember.premiumSince;
    if (virouBooster) {
        const guild = newMember.guild;
        const cargoVip = guild.roles.cache.find(r => r.name === '专 VIP Member');
        const canalNero = guild.channels.cache.find(c => c.name === './/nero');
        if (cargoVip) await newMember.roles.add(cargoVip).catch(() => {});
        if (canalNero) {
            await canalNero.send({ embeds: [new EmbedBuilder().setColor('#2C2A4A').setTitle('🔮 Novo Boost').setDescription(`${newMember} deu boost!`).addFields({ name: 'Tag', value: `\`${newMember.user.tag}\``, inline: true }, { name: 'Cargo VIP', value: '`Concedido`', inline: true }).setTimestamp()] });
        }
        await enviarLog(guild, '🔮 Novo Boost Recebido', `Membro deu boost e recebeu VIP.`, '#CC44FF', [{ name: 'Usuário', value: `\`${newMember.user.tag}\``, inline: true }, { name: 'ID', value: `\`${newMember.id}\``, inline: true }]);
    }
    const cargosAdicionados = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const cargosRemovidos = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (cargosAdicionados.size > 0 || cargosRemovidos.size > 0) {
        const campos = [];
        if (cargosAdicionados.size > 0) campos.push({ name: '✅ Cargos Adicionados', value: cargosAdicionados.map(r => `\`${r.name}\``).join(', ') });
        if (cargosRemovidos.size > 0) campos.push({ name: '❌ Cargos Removidos', value: cargosRemovidos.map(r => `\`${r.name}\``).join(', ') });
        await enviarLog(newMember.guild, '🎭 Cargos Alterados', `Cargos modificados.`, '#4488FF', [{ name: 'Usuário', value: `\`${newMember.user.tag}\``, inline: true }, { name: 'ID', value: `\`${newMember.id}\``, inline: true }, ...campos]);
    }
});

client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    if (!message.content || message.content.trim() === '') return;
    const eXingamento = PALAVROES.some(p => normalizarTexto(message.content).includes(normalizarTexto(p)));
    if (eXingamento) return;
    await enviarLog(message.guild, '🗑️ Mensagem Deletada', `Mensagem deletada manualmente.`, '#888888', [
        { name: 'Autor', value: message.author ? `\`${message.author.tag}\`` : '`Desconhecido`', inline: true },
        { name: 'Canal', value: `${message.channel}`, inline: true },
        { name: 'Conteúdo', value: `\`\`\`${message.content.substring(0, 500)}\`\`\`` }
    ]);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.id === client.user.id) {
        if (!oldState.channelId || newState.channelId) return;
        const session = proxxySession.get(oldState.guild.id);
        if (!session || session.channelId !== oldState.channelId) return;
        proxxySession.delete(oldState.guild.id);
        const dur = Math.floor((Date.now() - session.startTime) / 1000);
        try { const c = oldState.guild.channels.cache.get(session.channelId); if (c) await c.delete(); } catch (e) {}
        await enviarDM('📊 Sessão .//Proxxy Encerrada', `**Servidor:** \`${oldState.guild.name}\`\n**Duração:** \`${Math.floor(dur/60)}m ${dur%60}s\`\n**Encerrado em:** \`${new Date().toLocaleString('pt-BR')}\`\n**Status:** Canal deletado automaticamente`, '#2C2A4A');
        return;
    }
    if (!oldState.channelId && newState.channelId) {
        await enviarLog(newState.guild, '🔊 Entrou em Voz', `Membro entrou em canal de voz.`, '#2266CC', [{ name: 'Usuário', value: `\`${newState.member?.user.tag ?? '?'}\``, inline: true }, { name: 'Canal', value: `\`${newState.channel?.name ?? '?'}\``, inline: true }]);
    } else if (oldState.channelId && !newState.channelId) {
        await enviarLog(oldState.guild, '🔇 Saiu de Voz', `Membro saiu de canal de voz.`, '#664488', [{ name: 'Usuário', value: `\`${oldState.member?.user.tag ?? '?'}\``, inline: true }, { name: 'Canal', value: `\`${oldState.channel?.name ?? '?'}\``, inline: true }]);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const { customId, member, guild } = interaction;
        if (customId === 'solicitar_verificacao') {
            if (config.usuariosAgurdando?.includes(member.id)) return interaction.reply({ content: 'Seu pedido já foi enviado.', ephemeral: true });
            const staffCh = guild.channels.cache.find(c => c.name === 'staff-gate');
            if (!staffCh) return interaction.reply({ content: 'Erro: canal staff-gate não encontrado.', ephemeral: true });
            if (!config.usuariosAgurdando) config.usuariosAgurdando = [];
            config.usuariosAgurdando.push(member.id); saveConfig();
            await interaction.reply({ content: '✦ Solicitação registrada. Aguarde aprovação.', ephemeral: true });
            const embedAdm = new EmbedBuilder().setColor('#0F0F10').setTitle('⚖️ Verificação Pendente').setDescription(`${member} quer entrar.`).addFields({ name: 'Tag', value: `\`${member.user.tag}\``, inline: true }, { name: 'ID', value: `\`${member.id}\``, inline: true }).setTimestamp();
            await staffCh.send({ embeds: [embedAdm], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`aprovar_${member.id}`).setLabel('✦ Permitir').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`recusar_${member.id}`).setLabel('☠ Barrar').setStyle(ButtonStyle.Danger))] });
            await enviarLog(guild, '🚪 Solicitação de Acesso', `Novo usuário solicitou verificação.`, '#FFAA00', [{ name: 'Usuário', value: `\`${member.user.tag}\``, inline: true }, { name: 'ID', value: `\`${member.id}\``, inline: true }]);
            return;
        }
        if (interaction.user.id !== guild.ownerId && !member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Sem hierarquia.', ephemeral: true });
        if (customId.startsWith('aprovar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                const cargo = guild.roles.cache.find(r => r.name === 'user');
                if (cargo) await alvo.roles.add(cargo);
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#1C1A27').setTitle('✓ Acesso Liberado').setDescription(`Liberado por: ${interaction.user}`)], components: [] });
                await enviarLog(guild, '✅ Acesso Aprovado', `Usuário liberado.`, '#00FF88', [{ name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'ID', value: `\`${userId}\``, inline: true }]);
            } catch (e) { config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig(); }
        }
        if (customId.startsWith('recusar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                await alvo.kick('Barrado no Gate.');
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#0A0A0A').setTitle('☠ Barrado e Expulso').setDescription(`Rejeitado por: ${interaction.user}`)], components: [] });
                await enviarLog(guild, '☠ Acesso Negado & Kick', `Barrado e expulso.`, '#FF4444', [{ name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'ID', value: `\`${userId}\``, inline: true }]);
            } catch (e) { config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig(); }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = interaction;

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Sem permissão.', ephemeral: true });
    }

    if (commandName === 'setup-logs') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        config.logsChannelId = null; saveConfig();
        const ch = await getOrCreateLogsChannel(guild);
        if (!ch) return interaction.editReply({ content: 'Erro ao criar canal.' });
        await ch.send({ embeds: [new EmbedBuilder().setColor('#2C2A4A').setTitle('📊 Sistema de Logs Ativo').setDescription('Canal privado de logs.\nSomente o dono (por ID) pode ver.').setTimestamp()] });
        return interaction.editReply({ content: `✅ Canal criado: ${ch}` });
    }

    if (commandName === 'proxxy') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        if (proxxySession.has(guild.id)) return interaction.reply({ content: '⚠️ Sessão já ativa.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
            const vc = await guild.channels.create({ name: './/Proxxy', type: ChannelType.GuildVoice, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }, { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }] });
            joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfMute: true, selfDeaf: true });
            proxxySession.set(guild.id, { channelId: vc.id, startTime: Date.now() });
            await enviarLog(guild, '🔒 Sessão .//Proxxy Iniciada', `Canal privado criado.`, '#2C2A4A', [{ name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }]);
            return interaction.editReply({ content: `✅ Canal \`.//Proxxy\` criado. Expulse o bot para encerrar.` });
        } catch (e) { return interaction.editReply({ content: `Erro: ${e.message}` }); }
    }

    if (commandName === 'neural') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const rel = gerarRelatorioNeural(guild);
        if (!rel) return interaction.editReply({ content: '🧠 Dados insuficientes ainda. O bot precisa observar mais mensagens.' });
        const { topAtivos, comInfluencia, grupos, conflitos, total } = rel;
        const embed = new EmbedBuilder()
            .setColor('#0D0C1D')
            .setTitle('🧠 Sistema Neural — Análise do Servidor')
            .setDescription(`Analisando **${total} membros** monitorados.\n\n*Quanto mais o servidor usa, mais preciso fica.*`)
            .addFields(
                { name: '📊 Membros Mais Ativos', value: topAtivos.length > 0 ? topAtivos.map(([id, d], i) => `**${i+1}.** <@${id}> — \`${d.messages} msgs\``).join('\n') : '*Nenhum.*', inline: false },
                { name: '⭐ Mais Influentes (citados por outros)', value: comInfluencia.length > 0 ? comInfluencia.map((x, i) => `**${i+1}.** <@${x.id}> — \`${x.mencoes}x citado\``).join('\n') : '*Nenhum ainda.*', inline: false },
                { name: '🔗 Panelinhas Detectadas', value: grupos.length > 0 ? grupos.map((g, i) => `**Grupo ${i+1}:** ${g.membros.map(id => `<@${id}>`).join(' · ')}`).join('\n') : '*Nenhuma ainda.*', inline: false },
                { name: '⚠️ Possíveis Conflitos', value: conflitos.length > 0 ? conflitos.map(([id, d]) => `<@${id}> — \`${d.warns||0} warns\` · \`${d.deletedMsgs||0} msgs deletadas\``).join('\n') : '*Nenhum.*', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'NaniBot v2.4.1 • Sistema Neural Privado' });
        await enviarLog(guild, '🧠 Relatório Neural Gerado', `Dono consultou análise.`, '#0D0C1D', [{ name: 'Membros', value: `\`${total}\``, inline: true }]);
        return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'neural-reset') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        config.neural = { members: {} }; saveConfig();
        return interaction.reply({ content: '🧠 Dados Neural apagados. Começa do zero.', ephemeral: true });
    }

    if (commandName === 'autorole') {
        await interaction.deferReply({ ephemeral: true });
        const cargo = options.getRole('cargo');
        if (guild.members.me.roles.highest.position <= cargo.position) return interaction.editReply({ content: 'Erro de hierarquia.' });
        config.autoroleId = cargo.id; saveConfig();
        return interaction.editReply({ content: `Cargo automático: \`${cargo.name}\`` });
    }

    if (commandName === 'ban') {
        const alvo = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Banido por infração.';
        try {
            await guild.members.ban(alvo, { reason: motivo });
            await enviarLog(guild, '⚔️ Membro Banido', `Banimento executado.`, '#FF0000', [{ name: 'Banido', value: `\`${alvo.tag}\``, inline: true }, { name: 'ID', value: `\`${alvo.id}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'Motivo', value: `\`${motivo}\`` }]);
            return interaction.reply({ content: `⚔️ **${alvo.tag}** banido. Motivo: ${motivo}` });
        } catch (e) { return interaction.reply({ content: `Erro: Permissões insuficientes.`, ephemeral: true }); }
    }

    if (commandName === 'kick') {
        const alvo = options.getMember('membro');
        const motivo = options.getString('motivo') || 'Expulso por infração.';
        try {
            const tag = alvo.user.tag; const id = alvo.id;
            await alvo.kick(motivo);
            await enviarLog(guild, '👢 Membro Expulso', `Kick executado.`, '#FF8800', [{ name: 'Expulso', value: `\`${tag}\``, inline: true }, { name: 'ID', value: `\`${id}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'Motivo', value: `\`${motivo}\`` }]);
            return interaction.reply({ content: `👢 **${tag}** expulso.` });
        } catch (e) { return interaction.reply({ content: `Erro: Permissões insuficientes.`, ephemeral: true }); }
    }

    if (commandName === 'mute') {
        const alvo = options.getMember('membro');
        const tempo = options.getInteger('tempo');
        try {
            await alvo.timeout(tempo * 60 * 1000, 'Castigado por staff.');
            await enviarLog(guild, '⏸️ Membro Silenciado', `Timeout aplicado.`, '#FFAA00', [{ name: 'Silenciado', value: `\`${alvo.user.tag}\``, inline: true }, { name: 'ID', value: `\`${alvo.id}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'Duração', value: `\`${tempo}min\``, inline: true }]);
            return interaction.reply({ content: `⚖️ ${alvo} silenciado por ${tempo} minutos.` });
        } catch (e) { return interaction.reply({ content: `Erro ao silenciar.`, ephemeral: true }); }
    }

    if (commandName === 'limpar') {
        await interaction.deferReply({ ephemeral: true });
        const qtd = options.getInteger('quantidade');
        try {
            const del = await channel.bulkDelete(qtd, true);
            await enviarLog(guild, '🧹 Limpeza de Mensagens', `Mensagens deletadas em massa.`, '#888888', [{ name: 'Canal', value: `${channel}`, inline: true }, { name: 'Qtd', value: `\`${del.size}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }]);
            return interaction.editReply({ content: `${del.size} mensagens deletadas.` });
        } catch (e) { return interaction.editReply({ content: `Erro ao limpar.` }); }
    }

    if (commandName === 'apelido') {
        const alvo = options.getMember('membro');
        const novoApelido = options.getString('novo-apelido') || null;
        try {
            await alvo.setNickname(novoApelido);
            await enviarLog(guild, '✏️ Apelido Alterado', `Apelido modificado.`, '#4488FF', [{ name: 'Usuário', value: `\`${alvo.user.tag}\``, inline: true }, { name: 'Depois', value: `\`${novoApelido ?? 'resetado'}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }]);
            return interaction.reply({ content: `Apelido alterado.`, ephemeral: true });
        } catch (e) { return interaction.reply({ content: `Erro de hierarquia.`, ephemeral: true }); }
    }

    if (commandName === 'warn') {
        const alvo = options.getMember('membro');
        const motivo = options.getString('motivo');
        const guildId = guild.id; const userId = alvo.id;
        if (!config.warns[guildId]) config.warns[guildId] = {};
        if (!config.warns[guildId][userId]) config.warns[guildId][userId] = [];
        config.warns[guildId][userId].push({ motivo, data: new Date().toLocaleString('pt-BR'), staff: interaction.user.tag });
        if (!config.neural) config.neural = { members: {} };
        if (!config.neural.members[userId]) config.neural.members[userId] = { tag: alvo.user.tag, messages: 0, mentionedBy: {}, warns: 0, deletedMsgs: 0 };
        config.neural.members[userId].warns = (config.neural.members[userId].warns || 0) + 1;
        saveConfig();
        const total = config.warns[guildId][userId].length;
        const limite = config.warnLimit || 3;
        await interaction.reply({ embeds: [new EmbedBuilder().setColor('#1C1A27').setTitle('⚠️ Advertência — Sistema Nero').setDescription(`${alvo} recebeu uma advertência.`).addFields({ name: 'Motivo', value: `\`${motivo}\`` }, { name: 'Staff', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'Total', value: `\`${total}/${limite}\``, inline: true }).setTimestamp()] });
        await enviarLog(guild, '⚠️ Warn Registrado', `Advertência adicionada.`, '#FFAA00', [{ name: 'Advertido', value: `\`${alvo.user.tag}\``, inline: true }, { name: 'ID', value: `\`${alvo.id}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }, { name: 'Motivo', value: `\`${motivo}\`` }, { name: 'Total', value: `\`${total}/${limite}\``, inline: true }]);
        if (total >= limite) {
            try {
                await alvo.timeout(60 * 60 * 1000, `Limite de warns (${total}/${limite})`);
                await interaction.channel.send({ embeds: [new EmbedBuilder().setColor('#0A0A0A').setTitle('🔒 Punição Automática').setDescription(`${alvo} atingiu ${total} warns e foi silenciado por 1 hora.\n\n*O sistema Nero não perdoa.*`).setTimestamp()] });
                await enviarLog(guild, '🔒 Punição Automática', `Timeout 1h por excesso de warns.`, '#FF4444', [{ name: 'Punido', value: `\`${alvo.user.tag}\``, inline: true }, { name: 'Warns', value: `\`${total}/${limite}\``, inline: true }]);
            } catch (e) {}
        }
        return;
    }

    if (commandName === 'warns') {
        const alvo = options.getUser('membro');
        const lista = config.warns?.[guild.id]?.[alvo.id] || [];
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2C2A4A').setTitle(`📋 Warns — ${alvo.tag}`).setDescription(lista.length === 0 ? '*Nenhuma.*' : lista.map((w, i) => `**${i+1}.** ${w.motivo} — *${w.data}* — \`${w.staff}\``).join('\n')).addFields({ name: 'Total', value: `\`${lista.length}/${config.warnLimit||3}\``, inline: true }).setTimestamp()], ephemeral: true });
    }

    if (commandName === 'limpar-warns') {
        const alvo = options.getUser('membro');
        const antes = config.warns?.[guild.id]?.[alvo.id]?.length || 0;
        if (config.warns?.[guild.id]) delete config.warns[guild.id][alvo.id];
        saveConfig();
        await enviarLog(guild, '🧹 Warns Limpos', `Advertências removidas.`, '#00FF88', [{ name: 'Usuário', value: `\`${alvo.tag}\``, inline: true }, { name: 'Removidos', value: `\`${antes}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }]);
        return interaction.reply({ content: `✅ Warns de **${alvo.tag}** limpos.`, ephemeral: true });
    }

    if (commandName === 'warn-limite') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        config.warnLimit = options.getInteger('numero'); saveConfig();
        return interaction.reply({ content: `✅ Limite: **${config.warnLimit} warns**`, ephemeral: true });
    }

    if (commandName === 'salvar-servidor') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
            const bkp = await backup.create(guild, { maxMessagesPerChannel: 20, jsonSave: true, jsonName: 'servidor_backup_completo' });
            config.ultimoBackupId = bkp.id; saveConfig();
            await enviarLog(guild, '💾 Backup Criado', `Backup salvo.`, '#00FF88', [{ name: 'ID', value: `\`${bkp.id}\``, inline: true }, { name: 'Por', value: `\`${interaction.user.tag}\``, inline: true }]);
            return interaction.editReply({ content: `✅ Backup criado!\n**ID:** \`${bkp.id}\`` });
        } catch (e) { return interaction.editReply({ content: `Falha: ${e.message}` }); }
    }

    if (commandName === 'carregar-servidor') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        if (!config.ultimoBackupId) return interaction.reply({ content: 'Nenhum backup salvo.', ephemeral: true });
        await interaction.reply({ content: '⚙️ Restaurando...', ephemeral: true });
        try { await backup.load(config.ultimoBackupId, guild, { clearGuildBeforeRestore: true }); } catch (e) { terminalLog('error', `Erro: ${e.message}`); }
        return;
    }

    if (commandName === 'setup-server') {
        if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Apenas o dono.', ephemeral: true });
        await interaction.reply({ content: '⚙️ Iniciando limpeza e blindagem...', ephemeral: true });

        const antigos = await guild.channels.fetch();
        for (const [, c] of antigos) { try { await c.delete(); } catch(e){} }
        const cargosAntigos = await guild.roles.fetch();
        for (const [, r] of cargosAntigos) { if (!r.managed && r.id !== guild.roles.everyone.id) { try { await r.delete(); } catch(e){} } }
        await guild.roles.everyone.setPermissions([PermissionFlagsBits.ReadMessageHistory]);

        const cargoMembro = await guild.roles.create({ name: 'user', color: '#555555', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        config.autoroleId = cargoMembro.id; saveConfig();
        const cargoVip = await guild.roles.create({ name: '专 VIP Member', color: '#2C2A4A', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        const cargoDono = await guild.roles.create({ name: '👑 Server Owner', color: '#010101', hoist: true, permissions: [PermissionFlagsBits.Administrator] });
        const cargoCoOwner = await guild.roles.create({ name: '🔱 Co-Owner', color: '#090A0C', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoDirector = await guild.roles.create({ name: '✦ Senior Director', color: '#121417', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoAdmin = await guild.roles.create({ name: '🛡️ Administrator', color: '#1B1E22', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoSrMod = await guild.roles.create({ name: '⚖️ Senior Moderator', color: '#25292F', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] });
        const cargoMod = await guild.roles.create({ name: '⚔️ Moderator', color: '#2F343C', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] });
        const cargoInspector = await guild.roles.create({ name: '👁️ Inspector', color: '#3A404A', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoHelper = await guild.roles.create({ name: '⚡ Staff Helper', color: '#464D59', hoist: true, permissions: [PermissionFlagsBits.View **...**

_This response is too long to display in full._
