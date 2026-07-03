const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

const { 
    Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, 
    EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent 
} = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Groq = require('groq-sdk');

const BOT_VERSION = "1.5.1"; 

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
}

// Inicialização segura do SDK da Groq para o ecossistema do Render
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    terminalLog('success', 'Módulo Llama 3 (Groq) acoplado com sucesso.');
} else {
    terminalLog('warn', 'GROQ_API_KEY ausente no painel do Render. Comando /command indisponível.');
}

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
let config = { autoroleId: null, usuariosAgurdando: [], ultimoBackupId: null, warns: {}, warnLimit: 3, logsChannelId: null, filtroXingamentosAtivo: true, shadowbanned: [] };

try { if (fs.existsSync(DATA_FILE)) { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); config = { ...config, ...saved }; } } catch (e) {}
function saveConfig() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); } catch(e) {} }

function isOwner(userId) { return userId === OWNER_ID; }

// --- SUBSISTEMA DE LOGS ---
async function enviarDM(titulo, message, cor, embedsExtras = []) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID, { force: true });
        const embed = new EmbedBuilder()
            .setColor(cor || '#0B0A14')
            .setAuthor({ name: 'Nero CyberSec • Notificação do Core', iconURL: client.user.displayAvatarURL() })
            .setTitle(`📡 ${titulo}`)
            .setDescription(`\`\`\`text\n${message}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: `Nero Engine v${BOT_VERSION}` });
        await owner.send({ embeds: [embed, ...embedsExtras] });
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
            .setTitle(`🛡️ Monitoramento — ${titulo}`)
            .setDescription(`${descricao}\n\n**Ocorrência:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setColor(corFinal)
            .setFooter({ text: `Nero CyberSec v${BOT_VERSION}` });

        if (campos && campos.length > 0) embedServidor.addFields(campos);
        if (informacoesUsuario) {
            embedServidor.addFields([{ name: '👤 Usuário Alvo', value: `\`${informacoesUsuario.tag}\` (${informacoesUsuario.id})` }]);
        }
        if (canalLogs) await canalLogs.send({ embeds: [embedServidor] });
    } catch (e) {}
}

function criarEmbedBase(titulo, descricao, cor = '#0B0A14') {
    return new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(descricao)
        .setColor(cor)
        .setTimestamp()
        .setFooter({ text: `Nero Security • v${BOT_VERSION}`, iconURL: client.user.displayAvatarURL() });
}

function gerarMenuConfirmacao() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmar_acao').setLabel('Confirmar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancelar_acao').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    );
}

// --- INTEGRAÇÃO NEURAL LLAMA 3 ---
async function processarPromptComLlama(guild, prompt, interaction) {
    const acoesExecutadas = [];
    const erros = [];

    // Mapeia e sanitiza o escopo do servidor para a IA não se perder com IDs inválidos
    const membrosDisponiveis = guild.members.cache.map(m => ({ id: m.id, tag: m.user.tag, nome: m.displayName.toLowerCase() }));
    const cargosDisponiveis = guild.roles.cache.map(r => ({ id: r.id, nome: r.name.toLowerCase() }));
    const canaisDisponiveis = guild.channels.cache.map(c => ({ id: c.id, nome: c.name.toLowerCase() }));

    const systemPrompt = `
    Você é a inteligência analítica central do bot Nero Core v${BOT_VERSION}. 
    Sua única função é traduzir comandos em linguagem natural humana para uma estrutura JSON rígida de ações automáticas de administração do Discord.

    Ações suportadas e parâmetros necessários:
    - "criar_cargo": { "nome": "string" }
    - "deletar_canal": { "id": "string" }
    - "atribuir_cargo": { "membroId": "string", "cargoId": "string" }
    - "limpar_mensagens": { "quantidade": number }
    - "banir_membro": { "membroId": "string", "motivo": "string" }
    - "mutar_membro": { "membroId": "string", "tempoMinutos": number }

    Dados estruturais do servidor atual para cruzamento de informações:
    Membros: ${JSON.stringify(membrosDisponiveis.slice(0, 80))}
    Cargos: ${JSON.stringify(cargosDisponiveis)}
    Canais: ${JSON.stringify(canaisDisponiveis)}

    Regras cruciais:
    1. Se o usuário falar nomes parciais ou menções quebradas, cruze com a lista para achar o ID exato.
    2. Responda APENAS com um array JSON válido contendo objetos no formato: [{ "acao": "nome_da_acao", "dados": { ... } }]
    3. Nunca adicione texto explicativo ou markdown de código (\`\`\`json). Apenas a string do array de forma bruta.
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Diretriz: "${prompt}"` }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.1,
        });

        const respostaBruta = chatCompletion.choices[0]?.message?.content?.trim();
        const jsonLimpo = respostaBruta.replace(/^```json|```$/g, '').trim();
        const ordens = JSON.parse(jsonLimpo);

        for (const ordem of ordens) {
            switch (ordem.acao) {
                case 'criar_cargo': {
                    const r = await guild.roles.create({ name: ordem.dados.nome, reason: 'Llama Terminal Core Engine' });
                    acoesExecutadas.push(`🔹 **Cargo Criado:** ${r} (\`${r.name}\`)`);
                    break;
                }
                case 'deletar_canal': {
                    const ch = guild.channels.cache.get(ordem.dados.id);
                    if (ch) {
                        const nome = ch.name;
                        await ch.delete();
                        acoesExecutadas.push(`🗑️ **Canal Expurgado:** \`#${nome}\``);
                    }
                    break;
                }
                case 'atribuir_cargo': {
                    const membro = await guild.members.fetch(ordem.dados.membroId);
                    const cargo = guild.roles.cache.get(ordem.dados.cargoId);
                    if (membro && cargo) {
                        await membro.roles.add(cargo);
                        acoesExecutadas.push(`👑 **Cargo Atribuído:** ${cargo} concedido a ${membro}`);
                    }
                    break;
                }
                case 'limpar_mensagens': {
                    const qtd = Math.min(ordem.dados.quantidade, 100);
                    await interaction.channel.bulkDelete(qtd, true);
                    acoesExecutadas.push(`🧹 **Expurgo Sincronizado:** \`${qtd}\` mensagens limpas.`);
                    break;
                }
                case 'banir_membro': {
                    const user = await client.users.fetch(ordem.dados.membroId);
                    await guild.members.ban(ordem.dados.membroId, { reason: ordem.dados.motivo || 'Ordem direta do Processador Llama' });
                    acoesExecutadas.push(`🔨 **Banimento de Elite:** \`${user.tag}\` foi expurgado.`);
                    break;
                }
                case 'mutar_membro': {
                    const membro = await guild.members.fetch(ordem.dados.membroId);
                    const tempo = ordem.dados.tempoMinutos || 10;
                    if (membro) {
                        await membro.timeout(tempo * 60 * 1000);
                        acoesExecutadas.push(`🤫 **Isolamento de Chat:** ${membro} silenciado por \`${tempo}\` minutos.`);
                    }
                    break;
                }
            }
        }
    } catch (err) {
        erros.push(`Falha no parser semântico Llama: \`${err.message}\``);
    }

    return { acoesExecutadas, erros };
}

// Port de escuta HTTP para manter o Render ativo (Web Service)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Nero Active'); }).listen(PORT);

client.on('ready', async () => {
    terminalLog('success', `Nero AI Core Framework rodando sob v${BOT_VERSION}`);
    
    const commands = [
        new SlashCommandBuilder().setName('versao').setDescription('Build estrutural do bot.'),
        new SlashCommandBuilder().setName('shadowban').setDescription('[MOD] Joga o membro no limbo silencioso e invisível.').addUserOption(o => o.setName('membro').setDescription('Alvo').setRequired(true)),
        new SlashCommandBuilder().setName('overwatch').setDescription('[OWNER] Painel avançado de varredura contra traições e abusos de poder.'),
        new SlashCommandBuilder().setName('limpar').setDescription('Executa purga de histórico no canal.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setRequired(true)),
        new SlashCommandBuilder().setName('command').setDescription('[OWNER] Terminal Processador Llama 3 via linguagem natural livre.').addStringOption(o => o.setName('prompt').setDescription('Diretriz em texto livre').setRequired(true))
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        client.guilds.cache.forEach(guild => {
            rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }).catch(() => {});
        });
    } catch (e) {}
});

// INTERCEPTADORES DINÂMICOS DO SHADOWBAN
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (config.shadowbanned && config.shadowbanned.includes(message.author.id)) {
        try { await message.delete(); return; } catch (e) {}
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || !reaction.message.guild) return;
    if (config.shadowbanned && config.shadowbanned.includes(user.id)) {
        try { await reaction.users.remove(user.id); } catch (e) {}
    }
});

// --- SISTEMA INTERATIVO DE INTERAÇÕES ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

    if (commandName === 'versao') {
        return interaction.reply({ embeds: [criarEmbedBase('⚙️ Compilação Ativa', `🤖 **Engine:** \`Nero Core v${BOT_VERSION}\`\n🧠 **LLM:** \`Meta Llama 3 (Groq API Cloud)\``, '#6366F1')] });
    }

    // COMANDO TERMINAL LLAMA 3
    if (commandName === 'command') {
        if (!isOwner(interaction.user.id)) {
            return interaction.reply({ embeds: [criarEmbedBase('⛔ Falha de Autenticação', 'Acesso negado às chaves mestres.', '#FF0000')], ephemeral: true });
        }

        if (!groq) {
            return interaction.reply({ embeds: [criarEmbedBase('❌ Subsistema Desativado', 'A chave `GROQ_API_KEY` não está configurada no Render.', '#FF0000')], ephemeral: true });
        }

        const promptInput = options.getString('prompt');
        await interaction.reply({ embeds: [criarEmbedBase('🦙 Consultando Redes Neurais Llama...', `\`\`\`text\n"${promptInput}"\n\`\`\`\n*A Llama 3 está descompilando as intenções...*`, '#6366F1')] });

        const resultado = await processarPromptComLlama(guild, promptInput, interaction);

        const embedFinal = new EmbedBuilder()
            .setTitle('🖥️ Terminal Nero Llama Core — Concluído')
            .setColor(resultado.acoesExecutadas.length > 0 ? '#6366F1' : '#FF0000')
            .setDescription(`**Prompt Executado:**\n\`\`\`text\n${promptInput}\n\`\`\``)
            .setTimestamp();

        if (resultado.acoesExecutadas.length > 0) {
            embedFinal.addFields({ name: '✅ Ações Executadas com Sucesso', value: resultado.acoesExecutadas.join('\n') });
        }
        if (resultado.erros.length > 0) {
            embedFinal.addFields({ name: '❌ Erros de Compilação/Permissão', value: resultado.erros.join('\n') });
        }
        if (resultado.acoesExecutadas.length === 0 && resultado.erros.length === 0) {
            embedFinal.setDescription(`**Prompt Recusado:**\n\`\`\`text\n${promptInput}\n\`\`\`\nA Llama não correlacionou a estrutura com nenhuma função primária.`);
        }

        await enviarLog(guild, 'Terminal Llama Acionado', `Diretrizes processadas via IA da Meta.`, '#6366F1', [{ name: 'Prompt', value: promptInput }]);
        return interaction.editReply({ embeds: [embedFinal] });
    }

    // COMANDO LIMPAR INTERATIVO
    if (commandName === 'limpar') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) return;
        const qtd = options.getInteger('quantidade');
        
        const menu = gerarMenuConfirmacao();
        const resposta = await interaction.reply({ 
            embeds: [criarEmbedBase('🧹 Confirmação de Purga', `Você deseja apagar \`${qtd}\` mensagens deste canal de forma irreversível?`, '#FFA500')], 
            components: [menu], 
            fetchReply: true 
        });

        const coletor = resposta.createMessageComponentCollector({ time: 15000 });
        coletor.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Ação restrita ao executor do comando.', ephemeral: true });
            
            if (i.customId === 'confirmar_acao') {
                await interaction.channel.bulkDelete(Math.min(qtd, 100), true);
                await i.update({ embeds: [criarEmbedBase('🧹 Linha do Tempo Limpa', `\`${qtd}\` mensagens foram obliteradas com sucesso.`, '#00FF00')], components: [] });
            } else {
                await i.update({ embeds: [criarEmbedBase('❌ Operação Abortada', 'O procedimento de limpeza de log foi cancelado.', '#FF0000')], components: [] });
            }
        });
        return;
    }

    // COMANDO SHADOWBAN
    if (commandName === 'shadowban') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) return;
        const membro = options.getUser('membro');
        if (!config.shadowbanned) config.shadowbanned = [];
        
        const index = config.shadowbanned.indexOf(membro.id);
        if (index > -1) {
            config.shadowbanned.splice(index, 1); saveConfig();
            return interaction.reply({ embeds: [criarEmbedBase('🔓 Conexão Sincronizada', `${membro} foi removido do shadowban com sucesso.`, '#00FF00')] });
        } else {
            config.shadowbanned.push(membro.id); saveConfig();
            return interaction.reply({ embeds: [criarEmbedBase('⛓️ Protocolo Limbo Ativo', `${membro} agora está em isolamento de rede invisível.`, '#2C2A4A')] });
        }
    }

    // COMANDO OVERWATCH
    if (commandName === 'overwatch') {
        if (!isOwner(interaction.user.id)) return;
        await interaction.reply({ embeds: [criarEmbedBase('📡 Overwatch Ativado', 'Analizando base estrutural de logs do servidor...', '#FFA500')] });

        try {
            const auditLogs = await guild.fetchAuditLogs({ limit: 40 });
            const staffActions = {}; let abusos = [];

            auditLogs.entries.forEach(e => {
                if ([AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick, AuditLogEvent.MemberUpdate].includes(e.action)) {
                    staffActions[e.executor.id] = (staffActions[e.executor.id] || 0) + 1;
                }
            });
            Object.entries(staffActions).forEach(([id, count]) => {
                if (count > 4) abusos.push(`> ⚠️ <@${id}> realizou \`${count}\` ações administrativas em bloco.`);
            });

            const embedOverwatch = new EmbedBuilder()
                .setTitle('📡 Painel Overwatch — Contra-Inteligência Central')
                .setColor('#0B0A14')
                .addFields([
                    { name: '⚖️ Alertas de Abuso de Poder', value: abusos.join('\n') || '> 🟢 Staff operando sob padrões regulamentares estáveis.', inline: false },
                    { name: '🕵️ Integridade de Infraestrutura', value: auditLogs.entries.some(e => e.action === AuditLogEvent.RoleDelete) ? '> 🚨 Alterações recentes detectadas na hierarquia de cargos primários!' : '> 🟢 Estrutura operacional segura.', inline: false }
                ])
                .setTimestamp();

            return interaction.editReply({ embeds: [embedOverwatch] });
        } catch (e) {
            return interaction.editReply({ embeds: [criarEmbedBase('❌ Falha de Monitoramento', 'Não foi possível ler os registros de auditoria.', '#FF0000')] });
        }
    }
});

client.login(TOKEN);
