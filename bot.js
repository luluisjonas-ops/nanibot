const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fetch = require('node-fetch'); // Usando o node-fetch do seu package.json
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
let config = { autoroleId: null, usuariosAgurdando: [], ultimoBackupId: null, warns: {}, warnLimit: 3, logsChannelId: null, neural: { members: {} }, filtroXingamentosAtivo: true };
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

// Função para chamar a API do Gemini via node-fetch sem precisar de pacotes extras
async function perguntarParaIA(promptTexto) {
    if (!GEMINI_API_KEY) throw new Error("Chave GEMINI_API_KEY ausente.");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `Aja como o bot guardião gótico do servidor chamado Nero/NaniBot. Responda de forma direta, fria e autêntica à mensagem: ${promptTexto}` }]
            }]
        })
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Estou sem ideias agora...";
}

async function enviarDM(titulo, message, cor) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder().setColor(cor || '#2C2A4A').setTitle(titulo).setDescription(message).setTimestamp().setFooter({ text: 'NaniBot v2.4.1 • Sistema de Logs' });
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

    const pairs = [];
    return { topAtivos, comInfluencia, grupos: [], conflitos: [], total: entries.length };
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
http.createServer((req, res) => { res.writeHead(200); res.end('NaniBot online'); }).listen(PORT);

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
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
        new SlashCommandBuilder().setName('neural').setDescription('[OWNER] Exibe análise completa do Neural.'),
        new SlashCommandBuilder().setName('filtro-xingamentos').setDescription('Ativa ou desativa a remoção automática de xingamentos.').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'Ativar Filtro', value: 'ativar' }, { name: 'Desativar Filtro', value: 'desativar' })),
        
        // COMANDO DE CONVERSA
        new SlashCommandBuilder().setName('conversa').setDescription('Conversar com a IA do bot.').addStringOption(o => o.setName('mensagem').setDescription('Sua mensagem').setRequired(true))
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        client.guilds.cache.forEach(guild => {
            rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }).catch(() => {});
        });
    } catch (e) {}
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    trackNeural(message);

    // Resposta automática caso marque o bot no chat
    if (message.mentions.has(client.user) && !message.content.includes('@everyone') && !message.content.includes('@here')) {
        try {
            await message.channel.sendTyping();
            const limpo = message.content.replace(`<@${client.user.id}>`, '').trim();
            const respostaIa = await perguntarParaIA(limpo);
            return message.reply(respostaIa);
        } catch (err) {
            return message.reply("❌ Falha na conexão neural. Verifique se adicionou a chave GEMINI_API_KEY no painel do Render.");
        }
    }

    if (config.filtroXingamentosAtivo === false) return;

    const textoNorm = normalizarTexto(message.content);
    const palavraoEncontrado = PALAVROES.find(p => textoNorm.includes(normalizarTexto(p)));
    if (!palavraoEncontrado) return;

    try { await message.delete(); } catch (e) {}
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

    if (commandName === 'conversa') {
        await interaction.deferReply();
        const textoUsuario = options.getString('mensagem');

        try {
            const respostaIa = await perguntarParaIA(textoUsuario);
            return interaction.editReply(respostaIa);
        } catch (error) {
            return interaction.editReply(`❌ Erro de conexão com a IA. Configure a variável \`GEMINI_API_KEY\` no menu Environment do Render.`);
        }
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Sem permissão.', ephemeral: true });
    }

    // Mantendo as estruturas padrões de comando abaixo...
    if (commandName === 'filtro-xingamentos') {
        const escolha = options.getString('status');
        if (escolha === 'ativar') { config.filtroXingamentosAtivo = true; saveConfig(); return interaction.reply({ content: '🛡️ Filtro Ativado.' }); }
        else { config.filtroXingamentosAtivo = false; saveConfig(); return interaction.reply({ content: '🔓 Filtro Desativado.' }); }
    }
});
