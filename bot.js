const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fetch = require('node-fetch'); 
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

// Função do Gemini tunada com puro suco de Brainrot do TikTok de 2026
async function perguntarParaIA(promptTexto) {
    if (!GEMINI_API_KEY) throw new Error("Chave GEMINI_API_KEY ausente.");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `Você é o bot Nero/NaniBot. Seu humor é totalmente baseado nas trends do TikTok e puro brainrot de 2026 (use gírias como sigma, rizz, mewing, skibidi toilet, fanum tax, ohio, looksmaxxing, bop, cap, fr fr, chat is this real, bro thought he did something). Responda de forma curta, zoeira e extremamente irônica à mensagem: ${promptTexto}` }]
            }]
        })
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Mano, meu cérebro derreteu... Sem sinal de internet no Ohio 💀";
}

// Suas DMs de atualizações e erros que você tinha pedido de volta
async function enviarDM(titulo, message, cor) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder().setColor(cor || '#2C2A4A').setTitle(titulo).setDescription(message).setTimestamp().setFooter({ text: 'NaniBot v2.4.1 • Notificação Interna' });
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

client.on('guildMemberAdd', async (member) => {
    if (config.autoroleId) {
        try {
            const role = member.guild.roles.cache.get(config.autoroleId);
            if (role) await member.roles.add(role);
        } catch(e) {}
    }
});

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
    
    // Alerta o dono no privado sempre que o bot inicializar com sucesso
    await enviarDM("🚀 Bot Inicializado", `Nero/NaniBot subiu com sucesso e está monitorando agora mesmo!`, '#00FF00');

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
        new SlashCommandBuilder().setName('filtro-xingamentos').setDescription('Ativa ou desativa a remoção automática de xingamentos.').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'Ativar Filtro', value: 'ativar' }, { name: 'Desativar Filtro', value: 'desativar' }))
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

    // Resposta por marcação direta com Humor Brainrot 2026
    if (message.mentions.has(client.user) && !message.content.includes('@everyone') && !message.content.includes('@here')) {
        try {
            await message.channel.sendTyping();
            const limpo = message.content.replace(`<@${client.user.id}>`, '').trim();
            const respostaIa = await perguntarParaIA(limpo);
            return message.reply(respostaIa);
        } catch (err) {
            // Te avisa na DM se a API Key do Gemini quebrar
            await enviarDM("❌ Erro no Subsistema da IA", `Erro ao responder ${message.author.tag}: ${err.message}`, '#FF0000');
            return message.reply("🚨 Erro Crítico de Conexão no Ohio, verifique meu terminal.");
        }
    }

    if (config.filtroXingamentosAtivo === false) return;

    const textoNorm = normalizarTexto(message.content);
    const palavraoEncontrado = PALAVROES.find(p => textoNorm.includes(normalizarTexto(p)));
    if (!palavraoEncontrado) return;

    try { 
        await message.delete();
        if (!config.warns[message.author.id]) config.warns[message.author.id] = [];
        config.warns[message.author.id].push({ motivo: 'Uso de vocabulário proibido (Filtro Ativo)', data: new Date().toLocaleDateString() });
        saveConfig();
        
        await enviarLog(message.guild, '🛡️ Mensagem Retida', `Mensagem de ${message.author} deletada por conter xingamentos.`, '#FF0000', [{ name: 'Conteúdo original', value: `||${message.content}||` }]);
    } catch (e) {}
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Sem permissão.', ephemeral: true });
    }

    if (commandName === 'autorole') {
        const role = options.getRole('cargo');
        config.autoroleId = role.id;
        saveConfig();
        return interaction.reply(`✅ Cargo de entrada definido para: ${role}`);
    }

    if (commandName === 'filtro-xingamentos') {
        const escolha = options.getString('status');
        if (escolha === 'ativar') { config.filtroXingamentosAtivo = true; saveConfig(); return interaction.reply({ content: '🛡️ Filtro Ativado.' }); }
        else { config.filtroXingamentosAtivo = false; saveConfig(); return interaction.reply({ content: '🔓 Filtro Desativado.' }); }
    }

    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        await interaction.channel.bulkDelete(Math.min(qtd, 100), true);
        return interaction.reply({ content: `🧹 Eliminadas ${qtd} mensagens do histórico.`, ephemeral: true });
    }

    if (commandName === 'warn') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo');
        if (!config.warns[membro.id]) config.warns[membro.id] = [];
        config.warns[membro.id].push({ motivo, data: new Date().toLocaleDateString() });
        saveConfig();
        await enviarLog(guild, '⚠️ Advertência Aplicada', `Membro: ${membro}\nMotivo: ${motivo}`, '#FFA500');
        return interaction.reply(`⚠️ ${membro} foi advertido. Motivo: ${motivo}`);
    }

    if (commandName === 'warns') {
        const membro = options.getUser('membro');
        const lista = config.warns[membro.id] || [];
        if (lista.length === 0) return interaction.reply(`O membro ${membro} está com o prontuário limpo.`);
        const txt = lista.map((w, i) => `${i+1}. [${w.data}] - ${w.motivo}`).join('\n');
        return interaction.reply(`Histórico de ${membro}:\n${txt}`);
    }

    if (commandName === 'limpar-warns') {
        const membro = options.getUser('membro');
        config.warns[membro.id] = [];
        saveConfig();
        return interaction.reply(`✅ Histórico de advertências de ${membro} foi zerado.`);
    }

    if (commandName === 'ban') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Sem motivo especificado.';
        await guild.members.ban(membro.id, { reason: motivo });
        return interaction.reply(`🔨 ${membro.tag} foi banido permanente. Motivo: ${motivo}`);
    }

    if (commandName === 'kick') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Sem motivo especificado.';
        const target = await guild.members.fetch(membro.id);
        await target.kick(motivo);
        return interaction.reply(`👢 ${membro.tag} foi expulso do servidor.`);
    }

    if (commandName === 'mute') {
        const membro = options.getUser('membro');
        const tempo = options.getInteger('tempo');
        const target = await guild.members.fetch(membro.id);
        await target.timeout(tempo * 60 * 1000, 'Penalidade via comando');
        return interaction.reply(`🤫 ${membro} foi silenciado por ${tempo} minutos.`);
    }

    if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Comando restrito apenas ao Dono.', ephemeral: true });
    }

    if (commandName === 'setup-logs') {
        const ch = await getOrCreateLogsChannel(guild);
        return interaction.reply(`Logs configurados no canal ${ch}`);
    }

    if (commandName === 'proxxy') {
        let ch = guild.channels.cache.find(c => c.name === './/Proxxy');
        if (!ch) {
            ch = await guild.channels.create({ name: './/Proxxy', type: ChannelType.GuildVoice });
        }
        joinVoiceChannel({ channelId: ch.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        return interaction.reply(`Conectado silenciosamente ao canal ${ch.name}`);
    }

    if (commandName === 'salvar-servidor') {
        await interaction.reply('Iniciando backup completo...');
        const bData = await backup.create(guild, { maxMessagesPerChannel: 10 });
        config.ultimoBackupId = bData.id;
        saveConfig();
        return interaction.editReply(`Backup estrutural gerado com sucesso. ID: \`${bData.id}\``);
    }

    if (commandName === 'carregar-servidor') {
        if (!config.ultimoBackupId) return interaction.reply('Nenhum backup encontrado nos registros.');
        await interaction.reply('Restaurando infraestrutura...');
        await backup.load(config.ultimoBackupId, guild);
    }

    if (commandName === 'neural') {
        const relatorio = gerarRelatorioNeural(guild);
        if (!relatorio) return interaction.reply('Dados insuficientes no subsistema neural.');
        const embed = new EmbedBuilder().setTitle('Subsistema Neural — Relatório de Atividade').setColor('#2C2A4A');
        embed.addFields([
            { name: 'Membros Analisados', value: `${relatorio.total}`, inline: true },
            { name: 'Mais Ativos', value: relatorio.topAtivos.map(x => `${x[1].tag}: ${x[1].messages} msgs`).join('\n') || 'Nenhum' }
        ]);
        return interaction.reply({ embeds: [embed] });
    }
});

client.login(TOKEN);
