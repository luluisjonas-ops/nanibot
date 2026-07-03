const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Atualizado para usar a chave do Render

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Groq = require('groq-sdk'); // Importação da Groq acoplada

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

let groq = null;
if (GROQ_API_KEY) {
    groq = new Groq({ apiKey: GROQ_API_KEY });
    terminalLog('success', 'Módulo Llama 3 (Groq) injetado com sucesso no Core.');
} else {
    terminalLog('warn', 'GROQ_API_KEY não configurada no painel do Render.');
}

function isOwner(userId) { return userId === OWNER_ID; }

// ENGINE DE PROCESSAMENTO NEURAL LLAMA 3 (CONVERSA + COMANDOS AUTOMÁTICOS POR TEXTO DIRETO)
async function processarMensagemChatIA(guild, prompt, authorId, canalMensagem) {
    if (!groq) return { respostaTexto: "Deu um piripaque na minha IA. A chave GROQ_API_KEY não foi configurada no Render.", acoesExecutadas: [] };

    const membrosDisponiveis = guild.members.cache.map(m => ({ id: m.id, tag: m.user.tag, nome: m.displayName.toLowerCase() }));
    const cargosDisponiveis = guild.roles.cache.map(r => ({ id: r.id, nome: r.name.toLowerCase() }));

    const systemPrompt = `
    CONDIÇÃO DE SISTEMA: Você é o Nero/NaniBot, um assistente virtual gótico altamente inteligente, autêntico, adaptável e com um toque de sagacidade. Fale de igual para igual, de forma direta, clara, foda e use gírias naturais.
    Você recebe mensagens do chat comum. Se for uma conversa comum, responda de forma autêntica e sarcástica.
    
    Se o autor da mensagem for o Dono do bot (ID igual a "${OWNER_ID}") e ele solicitar uma punição ou comando administrativo por texto (ex: banir, mutar, dar cargo, limpar chat), você deve identificar as intenções e estruturar as ações. Se não for o dono pedindo punição, recuse com deboche.

    Ações suportadas (Apenas para o Dono):
    - "criar_cargo": { "nome": "string" }
    - "atribuir_cargo": { "membroId": "string", "cargoId": "string" }
    - "limpar_mensagens": { "quantidade": number }
    - "banir_membro": { "membroId": "string", "motivo": "string" }
    - "mutar_membro": { "membroId": "string", "tempoMinutos": number }

    Dados do servidor para cruzamento:
    Membros: ${JSON.stringify(membrosDisponiveis.slice(0, 70))}
    Cargos: ${JSON.stringify(cargosDisponiveis)}

    Saída obrigatória: Responda APENAS em formato JSON bruto, sem blocos de código markdown. Formato:
    {
       "respostaTexto": "Sua resposta falada para o chat aqui",
       "acoes": [ { "acao": "nome_da_acao", "dados": { ... } } ]
    }
    `;

    const acoesExecutadas = [];

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Usuário [${authorId}] enviou: "${prompt}"` }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.5,
        });

        const respostaBruta = chatCompletion.choices[0]?.message?.content?.trim();
        const jsonLimpo = respostaBruta.replace(/^```json|```$/g, '').trim();
        const resultado = JSON.parse(jsonLimpo);

        if (resultado.acoes && resultado.acoes.length > 0 && authorId === OWNER_ID) {
            for (const ordem of resultado.acoes) {
                switch (ordem.acao) {
                    case 'criar_cargo': {
                        const r = await guild.roles.create({ name: ordem.dados.nome, reason: 'Terminal de Chat Llama' });
                        acoesExecutadas.push(`🔹 Cargo **${r.name}** gerado via texto.`);
                        break;
                    }
                    case 'atribuir_cargo': {
                        const m = await guild.members.fetch(ordem.dados.membroId);
                        const r = guild.roles.cache.get(ordem.dados.cargoId);
                        if (m && r) { await m.roles.add(r); acoesExecutadas.push(`👑 Cargo ${r.name} entregue a ${m}.`); }
                        break;
                    }
                    case 'limpar_mensagens': {
                        const qtd = Math.min(ordem.dados.quantidade, 100);
                        await canalMensagem.bulkDelete(qtd, true);
                        acoesExecutadas.push(`🧹 Expurgadas ${qtd} mensagens via IA.`);
                        break;
                    }
                    case 'banir_membro': {
                        const m = await guild.members.fetch(ordem.dados.membroId);
                        if (m) {
                            await guild.members.ban(m.id, { reason: ordem.dados.motivo || 'Banido via chat IA pelo Dono' });
                            acoesExecutadas.push(`🔨 **${m.user.tag}** foi expurgado do servidor.`);
                        }
                        break;
                    }
                    case 'mutar_membro': {
                        const m = await guild.members.fetch(ordem.dados.membroId);
                        const tempo = ordem.dados.tempoMinutos || 10;
                        if (m) { await m.timeout(tempo * 60 * 1000); acoesExecutadas.push(`🤫 **${m.user.tag}** isolado por ${tempo} minutos.`); }
                        break;
                    }
                }
            }
        }

        return { respostaTexto: resultado.respostaTexto, acoesExecutadas };
    } catch (e) {
        return { respostaTexto: "Tive um soluço nas minhas conexões neurais aqui.", acoesExecutadas: [] };
    }
}

async function enviarDM(titulo, message, cor, embedsExtras = []) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder().setColor(cor || '#0B0A14').setTitle(titulo).setDescription(message).setTimestamp();
        await owner.send({ embeds: [embed, ...embedExtras] });
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
            topic: 'Sistema de logs privado — NaniBot Nero v2.5.0',
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

        if (campos && campos.length > 0) embedServidor.addFields(campos);

        if (informacoesUsuario) {
            embedServidor.addFields([
                { name: '👤 Infrator / Alvo', value: `**Tag:** \`${informacoesUsuario.tag}\`\n**Menção:** ${informacoesUsuario}\n**ID:** \`${informacoesUsuario.id}\``, inline: false }
            ]);
        }

        if (canalLogs) await canalLogs.send({ embeds: [embedServidor] });
    } catch (e) {
        terminalLog('error', `Falha ao organizar logs: ${e.message}`);
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
http.createServer((req, res) => { res.writeHead(200); res.end('Nero Engine Online'); }).listen(PORT);

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
    await enviarDM("🚀 Status do Sistema", `Nero v2.5.0 atualizado com a Llama 3 da Groq com sucesso.`, '#00FF00');

    const commands = [
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

// INTERCEPTADOR DE MENSAGENS COM PALAVRÕES, REGISTROS NEURAIS E CHAT INTELIGENTE COM LLAMA 3
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    trackNeural(message);

    // GATILHO CHAT INTELIGENTE (Marcar bot ou digitar os nomes chaves 'proxy' ou 'nero')
    const foiMarcado = message.mentions.has(client.user) && !message.content.includes('@everyone') && !message.content.includes('@here');
    const falouNomeBot = message.content.toLowerCase().includes('proxy') || message.content.toLowerCase().includes('nero');
    
    let ehRespostaAoBot = false;
    if (message.reference) {
        try {
            const msgRef = await message.channel.messages.fetch(message.reference.messageId);
            if (msgRef && msgRef.author.id === client.user.id) ehRespostaAoBot = true;
        } catch(e) {}
    }

    if (foiMarcado || ehRespostaAoBot || (falouNomeBot && message.content.length > 5)) {
        try {
            await message.channel.sendTyping();
            let textoLimpo = message.content.replace(`<@${client.user.id}>`, '').trim();

            const analise = await processarMensagemChatIA(message.guild, textoLimpo, message.author.id, message.channel);
            
            if (analise.acoesExecutadas && analise.acoesExecutadas.length > 0) {
                const embedAcoes = new EmbedBuilder()
                    .setTitle("🛠️ Execuções do Core Executadas")
                    .setColor("#6366F1")
                    .setDescription(analise.acoesExecutadas.join('\n'));
                
                await message.reply({ content: analise.respostaTexto, embeds: [embedAcoes] });
                await enviarLog(message.guild, 'Punição/Ordem de Chat', `IA executou comandos diretamente pelo chat comum.`, '#6366F1', [{ name: 'Comando original', value: message.content }]);
            } else {
                await message.reply(analise.respostaTexto);
            }
            return;
        } catch (err) {
            terminalLog('error', `Erro na IA: ${err.message}`);
            return message.reply("Deu um tilt nas minhas redes da Llama agora.");
        }
    }

    // FILTRO DE PALAVRÕES ORIGINAL INTEGRAL
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

// INTERAÇÕES VIA SLASH COMMANDS EXATAMENTE IGUAIS AO SEU SCRIPT ANTIGO
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

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
                await guild.roles.create({ name: nomeCargo, reason: 'Comando /cargo executado' });
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
        return interaction.editReply('Servidor restaurado com sucesso!');
    }
});

client.login(TOKEN);
