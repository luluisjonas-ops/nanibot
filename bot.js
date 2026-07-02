const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fetch = require('node-fetch'); 
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_VERSION = "1.1.0"; // Versão atualizada do Bot

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

try { if (fs.existsSync(DATA_FILE)) { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); config = { ...config, ...saved }; } } catch (e) {}
function saveConfig() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); } catch(e) {} }

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
}

function isOwner(userId) { return userId === OWNER_ID; }

async function perguntarParaIA(promptTexto, historicoAnterior = []) {
    if (!GEMINI_API_KEY) throw new Error("Chave GEMINI_API_KEY ausente.");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const contents = [
        {
            role: "user",
            parts: [{ text: "CONDIÇÃO DE SISTEMA: Você é o Nero/NaniBot, um assistente virtual gótico altamente inteligente, autêntico, adaptável e com um toque de sagacidade. Fale de igual para igual, de forma direta, clara e prestativa. Evite respostas robóticas, seja foda e use gírias naturais se o usuário também usar. Entendido?" }]
        },
        {
            role: "model",
            parts: [{ text: "Entendido perfeitamente. Sou o Nero, inteligência pura, gótico, direto ao ponto e sem respostas de robô. Pode mandar." }]
        }
    ];
    
    historicoAnterior.forEach(msg => {
        contents.push({
            role: msg.role === "model" ? "model" : "user",
            parts: [{ text: msg.text }]
        });
    });
    
    contents.push({
        role: "user",
        parts: [{ text: promptTexto }]
    });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            contents: contents,
            generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 2048,
            }
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Erro HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Processei tudo aqui, mas veio vazio. Manda de novo!";
}

async function enviarDM(titulo, message, cor, embedsExtras = []) {
    try {
        if (!OWNER_ID) return terminalLog('warn', 'OWNER_ID não configurado no arquivo .env.');
        const owner = await client.users.fetch(OWNER_ID, { force: true });
        const embed = new EmbedBuilder().setColor(cor || '#0B0A14').setTitle(titulo).setDescription(message).setTimestamp();
        await owner.send({ embeds: [embed, ...embedExtras] });
    } catch (e) {
        terminalLog('error', `Falha crítica ao enviar DM para o Owner (${OWNER_ID}): ${e.message}. Verifique se as DMs estão abertas.`);
    }
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
            topic: `Sistema de logs privado — NaniBot Nero v${BOT_VERSION}`,
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

async function enviarLog(guild, titulo, descricao, cor, campos, informacoesUsuario = null) {
    try {
        const canalLogs = await getOrCreateLogsChannel(guild);
        const corFinal = cor || '#0B0A14';
        
        const embedServidor = new EmbedBuilder()
            .setAuthor({ name: 'Nero Moderation Security', iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`🛡️ Sistema de Monitoramento — ${titulo}`)
            .setDescription(`${descricao}\n\n**Ocorrência registrada às:** <t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)`)
            .setColor(corFinal)
            .setThumbnail(guild.iconURL({ dynamic: true }) || null)
            .setFooter({ text: `Guild ID: ${guild.id} • Nero CyberSec`, iconURL: client.user.displayAvatarURL() });

        if (campos && campos.length > 0) {
            embedServidor.addFields(campos);
        }

        if (informacoesUsuario) {
            embedServidor.addFields([
                { name: '👤 Infrator / Alvo', value: `**Tag:** \`${informacoesUsuario.tag}\`\n**Menção:** ${informacoesUsuario}\n**ID:** \`${informacoesUsuario.id}\``, inline: false }
            ]);
        }

        if (canalLogs) await canalLogs.send({ embeds: [embedServidor] });
    } catch (e) {
        terminalLog('error', `Falha ao processar logs: ${e.message}`);
    }
}

const PALAVROES = [
    'porra', 'prr', 'caralho', 'crl', 'krl', 'krI', 'merda', 'mrd', 'bosta', 'bst', 'foda', 'foder', 'fdr', 'fodase', 'foda-se', 'fdms',
    'puta', 'pt', 'putaria', 'viado', 'vdo', 'vd', 'viadinho', 'cuzao', 'cuzão', 'cu', 'idiota', 'idta', 'imbecil', 'babaca', 'otario', 
    'trouxa', 'burro', 'vtnc', 'tnc', 'fdp', 'vnc', 'cornudo', 'corno', 'pnc', 'arrombado', 'arrombadinho', 'filho da puta', 'filha da puta', 
    'desgraçado', 'desgraca', 'vagabundo', 'vgb', 'cacete', 'cct', 'desgraça', 'puto', 'pqp', 'filho de uma puta', 'ramelao', 'otaria'
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
}

function gerarRelatorioNeural(guild) {
    const m = config.neural?.members || {};
    const entries = Object.entries(m).filter(([, d]) => d.messages > 0);
    if (entries.length === 0) return null;
    const topAtivos = [...entries].sort((a, b) => b[1].messages - a[1].messages).slice(0, 5);
    const comInfluencia = entries.map(([id, d]) => {
        const total = Object.values(d.mentionedBy || {}).reduce((a, b) => a + b, 0);
        return { id, tag: d.tag, mencoes: total };
    }).sort((a, b) => b.mencoes - a.mencoes).slice(0, 5).filter(x => x.mencoes > 0);
    return { topAtivos, comInfluencia, total: entries.length };
}

function normalizarTexto(texto) {
    let formatado = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    formatado = formatado.replace(/4/g, 'a').replace(/3/g, 'e').replace(/1/g, 'i').replace(/0/g, 'o').replace(/7/g, 't');
    return formatado.replace(/[^a-z0-9 ]/g, '');
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
    // NOTIFICAÇÃO OBRIGATÓRIA DE ATUALIZAÇÃO VIA DM
    await enviarDM("🚀 Status do Sistema", `Nero atualizado com sucesso.`, '#00FF00');

    const commands = [
        new SlashCommandBuilder().setName('versao').setDescription('Exibe a versão atual de compilação do bot.'),
        new SlashCommandBuilder().setName('autorole').setDescription('Define cargo automático.').addRoleOption(o => o.setName('cargo').setDescription('Cargo').setRequired(true)),
        new SlashCommandBuilder().setName('setup-server').setDescription('[OWNER] Monta a infraestrutura gótica de canais do servidor.'),
        new SlashCommandBuilder().setName('cargo').setDescription('[OWNER] Cria os 31 cargos temáticos estilo TikTok memes 2026.'),
        new SlashCommandBuilder().setName('setup-logs').setDescription('[OWNER] Cria ou recria o canal de logs privado.'),
        new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')),
        new SlashCommandBuilder().setName('mute').setDescription('Silencia temporariamente.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('tempo').setDescription('Tempo em minutos').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo')),
        new SlashCommandBuilder().setName('limpar').setDescription('Deleta mensagens.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true)),
        new SlashCommandBuilder().setName('apelido').setDescription('Altera apelido de um usuário.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('novo-apelido').setDescription('Novo apelido').setRequired(true)),
        new SlashCommandBuilder().setName('salvar-servidor').setDescription('[OWNER] Gera backup completo.'),
        new SlashCommandBuilder().setName('carregar-servidor').setDescription('[OWNER] Restaura o backup salvo.'),
        new SlashCommandBuilder().setName('proxxy').setDescription('[OWNER] Cria call .//Proxxy e entra nela silenciado.'),
        new SlashCommandBuilder().setName('warn').setDescription('Adiciona advertência.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
        new SlashCommandBuilder().setName('warns').setDescription('Ver advertências.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
        new SlashCommandBuilder().setName('limpar-warns').setDescription('Remove advertências.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)),
        new SlashCommandBuilder().setName('neural').setDescription('[OWNER] Exibe análise completa de atividade do Neural.'),
        new SlashCommandBuilder().setName('filtro-xingamentos').setDescription('Ativa/desativa a remoção de xingamentos.').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'Ativar Filtro', value: 'ativar' }, { name: 'Desativar Filtro', value: 'desativar' }))
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

    const foiMarcado = message.mentions.has(client.user) && !message.content.includes('@everyone') && !message.content.includes('@here');
    let ehRespostaAoBot = false;
    if (message.reference) {
        try {
            const msgRef = await message.channel.messages.fetch(message.reference.messageId);
            if (msgRef && msgRef.author.id === client.user.id) ehRespostaAoBot = true;
        } catch(e) {}
    }

    if (foiMarcado || ehRespostaAoBot) {
        try {
            await message.channel.sendTyping();
            let historico = [];
            let textoLimpo = message.content.replace(`<@${client.user.id}>`, '').trim();

            if (message.reference) {
                try {
                    const msgAntiga = await message.channel.messages.fetch(message.reference.messageId);
                    if (msgAntiga) {
                        if (msgAntiga.author.id === client.user.id) {
                            historico.push({ role: "user", text: "O que você me respondeu antes?" });
                            historico.push({ role: "model", text: msgAntiga.content });
                        } else {
                            historico.push({ role: "user", text: msgAntiga.content });
                        }
                    }
                } catch (e) {}
            }

            const respostaIa = await perguntarParaIA(textoLimpo, historico);
            return message.reply(respostaIa);

        } catch (err) {
            terminalLog('error', `Erro na IA: ${err.message}`);
            await enviarDM("❌ Falha Crítica no Gemini API", `**Mensagem do Erro:**\n\`\`\`text\n${err.message}\n\`\`\`\n**Localização:** Evento \`messageCreate\` (Resposta da Inteligência Artificial)`, '#FF0000');
            return message.reply("Deu um piripaque na minha IA. Já mandei os detalhes do erro pro meu dono no privado.");
        }
    }

    if (config.filtroXingamentosAtivo === false) return;
    
    const textoNorm = normalizarTexto(message.content);
    const palavrasDoTexto = textoNorm.split(/\s+/);
    
    const contemPalavrao = PALAVROES.some(p => {
        const pNorm = normalizarTexto(p);
        return palavrasDoTexto.includes(pNorm) || textoNorm.includes(pNorm);
    });

    if (contemPalavrao) {
        try { 
            await message.delete();
            await enviarLog(
                message.guild, 
                'Mensagem Retida por Violação', 
                `Uma mensagem foi interceptada e expurgada automaticamente do canal ${message.channel}.`, 
                '#D32F2F', 
                [
                    { name: '💬 Conteúdo Bruto Filtrado', value: `|| ${message.content} ||`, inline: false },
                    { name: '📍 Canal Relacionado', value: `${message.channel} (\`#${message.channel.name}\`)`, inline: true }
                ],
                message.author
            );
        } catch (e) {}
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

    // EXECUÇÃO DO COMANDO DE VERSÃO (ABERTO A TODOS OS USUÁRIOS)
    if (commandName === 'versao') {
        const embedVersao = new EmbedBuilder()
            .setColor('#2C2A4A')
            .setTitle('⚙️ Especificações de Compilação')
            .setDescription(`Atualmente operando sob a build estável estrutural.\n\n🤖 **Versão do Sistema:** \`v${BOT_VERSION}\``)
            .setTimestamp()
            .setFooter({ text: `${client.user.username} Core`, iconURL: client.user.displayAvatarURL() });
            
        return interaction.reply({ embeds: [embedVersao] });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
        return interaction.reply({ content: '⛔ Sem permissão.', ephemeral: true });
    }

    if (commandName === 'autorole') {
        const role = options.getRole('cargo');
        config.autoroleId = role.id; saveConfig();
        return interaction.reply(`✅ Cargo de entrada: ${role}`);
    }

    if (commandName === 'filtro-xingamentos') {
        const escolha = options.getString('status');
        config.filtroXingamentosAtivo = (escolha === 'ativar'); saveConfig();
        return interaction.reply({ content: config.filtroXingamentosAtivo ? '🛡️ Filtro Ativado.' : '🔓 Filtro Desativado.' });
    }

    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        await interaction.channel.bulkDelete(Math.min(qtd, 100), true);
        return interaction.reply({ content: `🧹 Deletadas ${qtd} mensagens.`, ephemeral: true });
    }

    if (commandName === 'apelido') {
        const membro = options.getUser('membro');
        const novoApelido = options.getString('novo-apelido');
        const target = await guild.members.fetch(membro.id);
        await target.setNickname(novoApelido);
        return interaction.reply(`🏷️ Apelido de ${membro} alterado para **${novoApelido}**.`);
    }

    if (commandName === 'warn') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo');
        if (!config.warns[membro.id]) config.warns[membro.id] = [];
        config.warns[membro.id].push({ motivo, data: new Date().toLocaleDateString() }); saveConfig();
        return interaction.reply(`⚠️ ${membro} advertido por: ${motivo}`);
    }

    if (commandName === 'warns') {
        const membro = options.getUser('membro');
        const lista = config.warns[membro.id] || [];
        if (lista.length === 0) return interaction.reply(`${membro} está limpo.`);
        return interaction.reply(`Histórico de ${membro}:\n` + lista.map((w, i) => `${i+1}. [${w.data}] - ${w.motivo}`).join('\n'));
    }

    if (commandName === 'limpar-warns') {
        const membro = options.getUser('membro');
        config.warns[membro.id] = []; saveConfig();
        return interaction.reply(`✅ Warns de ${membro} zerados.`);
    }

    if (commandName === 'ban') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Sem motivo.';
        await guild.members.ban(membro.id, { reason: motivo });
        return interaction.reply(`🔨 Banido: ${membro.tag}`);
    }

    if (commandName === 'kick') {
        const membro = options.getUser('membro');
        const target = await guild.members.fetch(membro.id);
        await target.kick();
        return interaction.reply(`👢 Expulso: ${membro.tag}`);
    }

    if (commandName === 'mute') {
        const membro = options.getUser('membro');
        const tempo = options.getInteger('tempo');
        const target = await guild.members.fetch(membro.id);
        await target.timeout(tempo * 60 * 1000);
        return interaction.reply(`🤫 Mutado por ${tempo} minutos.`);
    }

    if (!isOwner(interaction.user.id)) return interaction.reply({ content: '⛔ Restrito ao Dono.', ephemeral: true });

    if (commandName === 'setup-logs') {
        const ch = await getOrCreateLogsChannel(guild);
        return interaction.reply(`Canal de logs pronto em ${ch}`);
    }

    if (commandName === 'setup-server') {
        await interaction.reply('⚡ Estruturando canais, portaria e segurança do servidor...');
        try {
            await guild.channels.create({ name: '─── PORTARIA ───', type: ChannelType.GuildCategory });
        } catch(e) {}
        return interaction.editReply('⚡ Infraestrutura de canais criada com sucesso!');
    }

    if (commandName === 'cargo') {
        await interaction.reply('🔥 Gerando os 31 cargos temáticos baseados nas trends do TikTok e memes de 2026...');
        const cargosParaCriar = [
            "🧠 ✦ Sigma da Bahia","🗿 ✦ GigaChad Original","⛓️ ✦ Emo do Tiktok","🍷 ✦ Fino do Fino","💀 ✦ Ohio Resident",
            "💀 ✦ Cérebro Derretido","🩸 ✦ Cria de Jequié","💻 ✦ Script God","🌟 ✦ Patrocinador Premium",
            "💎 ✦ Booster Divino","🎭 ✦ Rei do POV","🎤 ✦ Podcast Host","🎨 ✦ Editor de Clipe",
            "🎵 ✦ Grunge Vibe","🎸 ✦ Metal Riff","🐾 ✦ Furry das Trevas","🕸️ ✦ Web Gótico",
            "🛹 ✦ Skater Boy","🎮 ✦ Tryhard 2026","☕ ✦ Copo de Caos","🌙 ✦ Vampiro Noturno",
            "🕯️ ✦ Ocultismo Puro","📖 ✦ Poeta de Tiktok","💔 ✦ Coração Partido","🥀 ✦ Dark Soul V2",
            "🪐 ✦ Skibidi Explorer","🧪 ✦ Alquimista","🃏 ✦ Admin Antissocial","🔋 ✦ Full Ativo 24h",
            "👻 ✦ Assombração do Chat","🧹 ✦ NPC Novato"
        ];
        for (const nomeCargo of cargosParaCriar) {
            if (!guild.roles.cache.some(r => r.name === nomeCargo)) {
                await guild.roles.create({ name: nomeCargo, reason: 'Comando /cargo executed' });
            }
        }
        return interaction.editReply('🔥 Todos os 31 cargos temáticos de memes/TikTok foram gerados e injetados com sucesso!');
    }

    if (commandName === 'neural') {
        const relatorio = gerarRelatorioNeural(guild);
        if (!relatorio) return interaction.reply('Dados insuficientes no subsistema neural.');
        const embed = new EmbedBuilder().setTitle('Subsistema Neural — Análise').setColor('#2C2A4A');
        embed.addFields([
            { name: 'Membros Monitorados', value: `${relatorio.total}`, inline: true },
            { name: 'Mais Ativos', value: relatorio.topAtivos.map(x => `${x[1].tag}: ${x[1].messages} msgs`).join('\n') || 'Nenhum' },
            { name: 'Maior Influência', value: relatorio.comInfluencia.map(x => `${x.tag}: mencionado ${x.mencoes} vezes`).join('\n') || 'Nenhum' }
        ]);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'proxxy') {
        let ch = guild.channels.cache.find(c => c.name === './/Proxxy') || await guild.channels.create({ name: './/Proxxy', type: ChannelType.GuildVoice });
        joinVoiceChannel({ channelId: ch.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        return interaction.reply(`Conectado no canal ${ch.name}`);
    }

    if (commandName === 'salvar-servidor') {
        await interaction.reply('Fazendo backup...');
        const bData = await backup.create(guild, { maxMessagesPerChannel: 1 });
        config.ultimoBackupId = bData.id; saveConfig();
        return interaction.editReply(`Backup Criado! ID: \`${bData.id}\``);
    }

    if (commandName === 'carregar-servidor') {
        if (!config.ultimoBackupId) return interaction.reply('Sem backup salvo.');
        await interaction.reply('Restaurando...');
        await backup.load(config.ultimoBackupId, guild);
    }
});

client.login(TOKEN);
