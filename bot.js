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

const BOT_VERSION = "1.3.0"; 

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
let config = { 
    autoroleId: null, 
    usuariosAgurdando: [], 
    ultimoBackupId: null, 
    warns: {}, 
    warnLimit: 3, 
    logsChannelId: null, 
    filtroXingamentosAtivo: true,
    shadowbanned: [] // Lista de IDs em Shadowban
};

try { if (fs.existsSync(DATA_FILE)) { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); config = { ...config, ...saved }; } } catch (e) {}
function saveConfig() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); } catch(e) {} }

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
}

function isOwner(userId) { return userId === OWNER_ID; }

async function enviarDM(titulo, message, cor, embedsExtras = []) {
    try {
        if (!OWNER_ID) return terminalLog('warn', 'OWNER_ID não configurado no arquivo .env.');
        const owner = await client.users.fetch(OWNER_ID, { force: true });
        
        const embed = new EmbedBuilder()
            .setColor(cor || '#0B0A14')
            .setAuthor({ name: 'Nero CyberSec • Notificação do Core', iconURL: client.user.displayAvatarURL() })
            .setTitle(`📡 ${titulo}`)
            .setDescription(`\`\`\`text\n${message}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: `Nero Engine v${BOT_VERSION}` });

        await owner.send({ embeds: [embed, ...embedsExtras] });
    } catch (e) {
        terminalLog('error', `Falha crítica real ao enviar DM para o Owner (${OWNER_ID}): ${e.message}`);
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
            .setTitle(`🛡️ Monitoramento — ${titulo}`)
            .setDescription(`${descricao}\n\n**Ocorrência:** <t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)`)
            .setColor(corFinal)
            .setThumbnail(guild.iconURL({ dynamic: true }) || null)
            .setFooter({ text: `Guild ID: ${guild.id} • Nero CyberSec v${BOT_VERSION}`, iconURL: client.user.displayAvatarURL() });

        if (campos && campos.length > 0) embedServidor.addFields(campos);

        if (informacoesUsuario) {
            embedServidor.addFields([
                { name: '👤 Usuário Alvo/Infrator', value: `> **Tag:** \`${informacoesUsuario.tag}\`\n> **Menção:** ${informacoesUsuario}\n> **ID:** \`${informacoesUsuario.id}\``, inline: false }
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

// CAPTURA DE SHTADOWBAN E REAÇÕES PROIBIDAS
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Execução do Shadowban (O cara envia, o bot deleta na hora e responde de forma efêmera se for comando ou apenas limpa para o chat comum)
    if (config.shadowbanned && config.shadowbanned.includes(message.author.id)) {
        try {
            await message.delete();
            // Avisa no canal oculto de logs o que o mutado tentou falar
            await enviarLog(message.guild, 'Filtro Shadowban', `Usuário restrito tentou enviar uma mensagem de forma invisível.`, '#2C2A4A', [
                { name: '💬 Conteúdo Ocultado', value: `\`\`\`text\n${message.content || '[Sem texto/Mídia]'}\n\`\`\`` }
            ], message.author);
            return;
        } catch (e) {}
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
                `Uma mensagem contendo termos proibidos foi interceptada e expurgada automaticamente do canal ${message.channel}.`, 
                '#D32F2F', 
                [
                    { name: '💬 Conteúdo Filtrado', value: `|| ${message.content} ||`, inline: false },
                    { name: '📍 Canal Relacionado', value: `${message.channel} (\`#${message.channel.name}\`)`, inline: true }
                ],
                message.author
            );
        } catch (e) {}
    }
});

// Bloqueia reações de quem está em Shadowban
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || !reaction.message.guild) return;
    if (config.shadowbanned && config.shadowbanned.includes(user.id)) {
        try {
            await reaction.users.remove(user.id);
        } catch (e) {}
    }
});

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

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
    await enviarDM("Status do Sistema", `Nero atualizado com sucesso para a versão v${BOT_VERSION}.`, '#00FF00');

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
        new SlashCommandBuilder().setName('neural').setDescription('[OWNER] Varre e analisa todo o histórico de mensagens do servidor.'),
        new SlashCommandBuilder().setName('filtro-xingamentos').setDescription('Ativa/desativa a remoção de xingamentos.').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'Ativar Filtro', value: 'ativar' }, { name: 'Desativar Filtro', value: 'desativar' })),
        
        // NOVOS COMANDOS SOLICITADOS
        new SlashCommandBuilder().setName('shadowban').setDescription('[MOD] Coloca ou remove um membro do limbo do silêncio invisível.').addUserOption(o => o.setName('membro').setDescription('Membro alvo').setRequired(true)),
        new SlashCommandBuilder().setName('overwatch').setDescription('[OWNER] Painel avançado de varredura contra traições, panelinhas e abusos de staff.')
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        client.guilds.cache.forEach(guild => {
            rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }).catch(() => {});
        });
    } catch (e) {}
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild } = interaction;

    if (commandName === 'versao') {
        const embed = criarEmbedBase('⚙️ Especificações de Compilação', `Atualmente operando sob build de alta performance.\n\n🤖 **Versão do Sistema:** \`v${BOT_VERSION}\``, '#2C2A4A');
        return interaction.reply({ embeds: [embed] });
    }

    // COMANDO INTERATIVO: SHADOWBAN
    if (commandName === 'shadowban') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
            return interaction.reply({ embeds: [criarEmbedBase('⛔ Erro', 'Sem permissão de gerenciamento.', '#FF0000')], ephemeral: true });
        }
        const membro = options.getUser('membro');
        
        if (!config.shadowbanned) config.shadowbanned = [];
        const index = config.shadowbanned.indexOf(membro.id);

        if (index > -1) {
            config.shadowbanned.splice(index, 1);
            saveConfig();
            return interaction.reply({ embeds: [criarEmbedBase('🔓 Limbo Desativado', `O usuário ${membro} foi removido do Shadowban. As mensagens dele voltaram ao normal.`, '#00FF00')] });
        } else {
            config.shadowbanned.push(membro.id);
            saveConfig();
            return interaction.reply({ embeds: [criarEmbedBase('⛓️ Shadowban Ativado', `O usuário ${membro} foi jogado no Limbo Invisível. Ele achará que está digitando normalmente, mas ninguém verá nada.`, '#2C2A4A')] });
        }
    }

    // COMANDO INTERATIVO MAX: OVERWATCH (CONTRA-INTELIGÊNCIA)
    if (commandName === 'overwatch') {
        if (!isOwner(interaction.user.id)) {
            return interaction.reply({ embeds: [criarEmbedBase('⛔ Restrito', 'Este painel é restrito estritamente ao desenvolvedor mestre.', '#FF0000')], ephemeral: true });
        }

        await interaction.reply({ embeds: [criarEmbedBase('📡 Executando Protocolo Overwatch', 'Escaneando banco de dados de auditoria, logs locais e comportamento da Staff...', '#FFA500')] });

        try {
            // 1. Detecção de Abuso de Poder (Audit Logs de Moderação)
            const auditLogs = await guild.fetchAuditLogs({ limit: 50 });
            const staffActions = {};
            let abusosDetectados = [];

            auditLogs.entries.forEach(entry => {
                if ([AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick, AuditLogEvent.MemberPrune, AuditLogEvent.MemberUpdate].includes(entry.action)) {
                    const executor = entry.executor.id;
                    if (!staffActions[executor]) staffActions[executor] = { tag: entry.executor.tag, count: 0 };
                    staffActions[executor].count++;
                }
            });

            Object.values(staffActions).forEach(staff => {
                if (staff.count > 5) {
                    abusosDetectados.push(`> ⚠️ **${staff.tag}** realizou mais de \`${staff.count}\` alterações/punições em lote recentemente.`);
                }
            });

            // 2. Detecção de Panelinhas e Membros Influentes via Histórico Cruzado
            const userActivity = {};
            const channels = await guild.channels.fetch();
            const textChannels = channels.filter(c => c.type === ChannelType.GuildText).slice(0, 3); // Amostra rápida de 3 canais principais

            for (const [_, ch] of textChannels) {
                try {
                    const msgs = await ch.messages.fetch({ limit: 50 });
                    msgs.forEach(m => {
                        if (m.author.bot) return;
                        userActivity[m.author.id] = (userActivity[m.author.id] || 0) + 1;
                    });
                } catch(e) {}
            }

            const topMembros = Object.entries(userActivity).sort((a,b) => b[1] - a[1]).slice(0, 3);
            let panelinhasStr = topMembros.map(([id, count]) => `> 👥 <@${id}> centraliza o fluxo com \`${count}\` interações brutas.`).join('\n') || '> *Fluxo estável em canais públicos.*';

            // 3. Detecção de Possíveis Traições/Admin Corrupto (Mudanças de cargos delicados)
            let traicoesStr = "> 🟢 Nenhuma alteração estrutural perigosa ou revogação de chaves encontrada.";
            const mudancasCargos = auditLogs.entries.filter(e => e.action === AuditLogEvent.RoleUpdate || e.action === AuditLogEvent.RoleDelete);
            if (mudancasCargos.size > 0) {
                traicoesStr = mudancasCargos.map(e => `> 🚨 **${e.executor.tag}** modificou ou deletou cargos administrativos estruturais recentemente.`).join('\n');
            }

            const embedOverwatch = new EmbedBuilder()
                .setTitle('📡 Painel Overwatch — Inteligência Interna do Core')
                .setColor('#0B0A14')
                .setDescription(`Análise analítica profunda e varredura de comportamento executada com sucesso absoluto.`)
                .addFields([
                    { name: '⚖️ Abuso de Poder (Staff)', value: abusosDetectados.join('\n') || '> 🟢 Comportamento da equipe operacional dentro dos parâmetros seguros.', inline: false },
                    { name: '🔥 Panelinhas & Membros Influentes', value: panelinhasStr, inline: false },
                    { name: '🕵️ Risco de Infraestrutura (Admin Corrupto / Traições)', value: traicoesStr, inline: false }
                ])
                .setTimestamp()
                .setFooter({ text: `Nero Engine Overwatch v${BOT_VERSION}`, iconURL: client.user.displayAvatarURL() });

            return interaction.editReply({ embeds: [embedOverwatch] });

        } catch (err) {
            return interaction.editReply({ embeds: [criarEmbedBase('❌ Falha Crítica', `Erro ao rodar subsistema de varredura: \`${err.message}\``, '#FF0000')] });
        }
    }

    // --- MANUTENÇÃO DOS DEMAIS COMANDOS COM EMBEDS E BOTÕES ---
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isOwner(interaction.user.id)) {
        const embed = criarEmbedBase('⛔ Acesso Negado', 'Você não possui privilégios suficientes.', '#FF0000');
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'autorole') {
        const role = options.getRole('cargo');
        config.autoroleId = role.id; saveConfig();
        return interaction.reply({ embeds: [criarEmbedBase('✅ Diretriz Atualizada', `Cargo de atribuição automática configurado para: ${role}`, '#00FF00')] });
    }

    if (commandName === 'filtro-xingamentos') {
        const escolha = options.getString('status');
        config.filtroXingamentosAtivo = (escolha === 'ativar'); saveConfig();
        return interaction.reply({ embeds: [criarEmbedBase(config.filtroXingamentosAtivo ? '🛡️ Filtro Ativado' : '🔓 Filtro Desativado', config.filtroXingamentosAtivo ? 'Segurança ativa.' : 'Filtragem desativada.', config.filtroXingamentosAtivo ? '#00FF00' : '#FFA500')] });
    }

    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        const embedPerg = criarEmbedBase('🧹 Solicitação de Limpeza', `Você tem certeza que deseja expurgar \`${qtd}\` mensagens deste canal?`, '#FFA500');
        const menu = gerarMenuConfirmacao();
        const resposta = await interaction.reply({ embeds: [embedPerg], components: [menu], fetchReply: true });
        const coletor = resposta.createMessageComponentCollector({ time: 15000 });
        coletor.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: '⛔ Negado.', ephemeral: true });
            if (i.customId === 'confirmar_acao') {
                await interaction.channel.bulkDelete(Math.min(qtd, 100), true);
                await i.update({ embeds: [criarEmbedBase('🧹 Limpeza Concluída', `O canal foi limpo com sucesso. \`${qtd}\` mensagens foram deletadas.`, '#00FF00')], components: [] });
            } else {
                await i.update({ embeds: [criarEmbedBase('❌ Operação Cancelada', 'A limpeza foi abortada.', '#FF0000')], components: [] });
            }
        });
        return;
    }

    if (commandName === 'apelido') {
        const membro = options.getUser('membro');
        const novoApelido = options.getString('novo-apelido');
        const target = await guild.members.fetch(membro.id);
        await target.setNickname(novoApelido);
        return interaction.reply({ embeds: [criarEmbedBase('🏷️ Apelido Alterado', `Identificação de ${membro} reconfigurada para **${novoApelido}**.`, '#00FF00')] });
    }

    if (commandName === 'warn') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo');
        if (!config.warns[membro.id]) config.warns[membro.id] = [];
        config.warns[membro.id].push({ motivo, data: new Date().toLocaleDateString() }); saveConfig();
        await enviarLog(guild, 'Advertência Registrada', `Membro advertido por violação de comportamento.`, '#FFA500', [{ name: 'Motivo', value: motivo }], membro);
        return interaction.reply({ embeds: [criarEmbedBase('⚠️ Advertência Aplicada', `O usuário ${membro} recebeu um aviso.\n\n**Motivo:** \`${motivo}\``, '#FFA500')] });
    }

    if (commandName === 'warns') {
        const membro = options.getUser('membro');
        const lista = config.warns[membro.id] || [];
        if (lista.length === 0) return interaction.reply({ embeds: [criarEmbedBase('🛡️ Registro Limpo', `O usuário ${membro} não possui advertências.`, '#00FF00')] });
        const desc = lista.map((w, i) => `**${i+1}.** \`[${w.data}]\` — ${w.motivo}`).join('\n');
        return interaction.reply({ embeds: [criarEmbedBase(`📋 Histórico de Advertências — ${membro.tag}`, desc, '#FFA500')] });
    }

    if (commandName === 'limpar-warns') {
        const membro = options.getUser('membro');
        config.warns[membro.id] = []; saveConfig();
        return interaction.reply({ embeds: [criarEmbedBase('✅ Registros Zerados', `A ficha de punições de ${membro} foi limpa.`, '#00FF00')] });
    }

    if (commandName === 'ban') {
        const membro = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Sem motivo informado.';
        const embedPerg = criarEmbedBase('🔨 Protocolo de Banimento', `Confirme o banimento permanente de ${membro}.`, '#FF0000');
        const menu = gerarMenuConfirmacao();
        const resposta = await interaction.reply({ embeds: [embedPerg], components: [menu], fetchReply: true });
        const coletor = resposta.createMessageComponentCollector({ time: 15000 });
        coletor.on('collect', async i => {
            if (i.customId === 'confirmar_acao') {
                await guild.members.ban(membro.id, { reason: motivo });
                await i.update({ embeds: [criarEmbedBase('🔨 Banimento Executado', `O usuário \`${membro.tag}\` foi expulso permanentemente.`, '#FF0000')], components: [] });
                await enviarLog(guild, 'Banimento de Membro', `Usuário banido.`, '#FF0000', [{ name: 'Motivo', value: motivo }], membro);
            } else {
                await i.update({ embeds: [criarEmbedBase('❌ Operação Abortada', 'Cancelado.', '#00FF00')], components: [] });
            }
        });
        return;
    }

    if (commandName === 'kick') {
        const membro = options.getUser('membro');
        const target = await guild.members.fetch(membro.id);
        await target.kick();
        await enviarLog(guild, 'Membro Expulso', `Usuário desconectado.`, '#FFA500', null, membro);
        return interaction.reply({ embeds: [criarEmbedBase('👢 Expulsão Concluída', `O usuário \`${membro.tag}\` foi expulso do servidor.`, '#FFA500')] });
    }

    if (commandName === 'mute') {
        const membro = options.getUser('membro');
        const tempo = options.getInteger('tempo');
        const target = await guild.members.fetch(membro.id);
        await target.timeout(tempo * 60 * 1000);
        await enviarLog(guild, 'Isolamento Temporário (Mute)', `Membro mutado.`, '#FFA500', [{ name: 'Tempo', value: `${tempo} minutos` }], membro);
        return interaction.reply({ embeds: [criarEmbedBase('🤫 Castigo Aplicado', `O usuário ${membro} foi silenciado por \`${tempo}\` minutos.`, '#FFA500')] });
    }

    if (!isOwner(interaction.user.id)) return;

    if (commandName === 'setup-logs') {
        const ch = await getOrCreateLogsChannel(guild);
        return interaction.reply({ embeds: [criarEmbedBase('🛡️ Infraestrutura de Logs', `Canal de logs operacional em ${ch}`, '#00FF00')] });
    }

    if (commandName === 'setup-server') {
        try { await guild.channels.create({ name: '─── PORTARIA ───', type: ChannelType.GuildCategory }); } catch(e) {}
        return interaction.reply({ embeds: [criarEmbedBase('⚡ Concluído', 'Arquitetura de portaria injetada.', '#00FF00')] });
    }

    if (commandName === 'cargo') {
        await interaction.reply({ embeds: [criarEmbedBase('🔥 Injetando Cargos', 'Gerando 31 cargos temáticos...', '#FFA500')] });
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
        return interaction.editReply({ embeds: [criarEmbedBase('🔥 Processo Finalizado', 'Todos os 31 cargos temáticos foram injetados!', '#00FF00')] });
    }

    if (commandName === 'proxxy') {
        let ch = guild.channels.cache.find(c => c.name === './/Proxxy') || await guild.channels.create({ name: './/Proxxy', type: ChannelType.GuildVoice });
        joinVoiceChannel({ channelId: ch.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        return interaction.reply({ embeds: [criarEmbedBase('🔌 Conexão Ativa', `O Bot conectou na sala vocal: ${ch.name}`, '#00FF00')] });
    }

    if (commandName === 'salvar-servidor') {
        const bData = await backup.create(guild, { maxMessagesPerChannel: 1 });
        config.ultimoBackupId = bData.id; saveConfig();
        return interaction.reply({ embeds: [criarEmbedBase('💾 Backup Salvo', `ID de restauração: \`${bData.id}\``, '#00FF00')] });
    }

    if (commandName === 'carregar-servidor') {
        if (!config.ultimoBackupId) return interaction.reply({ embeds: [criarEmbedBase('❌ Erro', 'Nenhum backup encontrado.', '#FF0000')] });
        await backup.load(config.ultimoBackupId, guild);
    }

    if (commandName === 'neural') {
        await interaction.reply({ embeds: [criarEmbedBase('🧠 Varredura Ativa', 'Analisando canais...', '#FFA500')] });
        try {
            const userStats = {}; const wordStats = {}; let totalMessagesScanned = 0;
            const channels = await guild.channels.fetch();
            const textChannels = channels.filter(c => c.type === ChannelType.GuildText);

            for (const [_, channel] of textChannels) {
                try {
                    const messages = await channel.messages.fetch({ limit: 100 });
                    if (messages.size === 0) continue;
                    totalMessagesScanned += messages.size;
                    messages.forEach(msg => {
                        if (msg.author.bot) return;
                        if (!userStats[msg.author.id]) userStats[msg.author.id] = { tag: msg.author.tag, count: 0 };
                        userStats[msg.author.id].count++;
                        const palavras = msg.content.toLowerCase().split(/\s+/);
                        palavras.forEach(p => {
                            const limpa = p.replace(/[^a-z0-9]/g, '');
                            if (limpa.length > 3) wordStats[limpa] = (wordStats[limpa] || 0) + 1;
                        });
                    });
                } catch (err) { continue; }
            }

            const topUsers = Object.values(userStats).sort((a, b) => b.count - a.count).slice(0, 5);
            const topWords = Object.entries(wordStats).sort((a, b) => b[1] - a[1]).slice(0, 5);

            const embedNeural = new EmbedBuilder()
                .setTitle('🧠 Subsistema Neural — Relatório Avançado')
                .setColor('#0F0E17')
                .addFields([
                    { name: '📊 Mensagens Mapeadas', value: `\`${totalMessagesScanned}\` pacotes analisados.`, inline: false },
                    { name: '👑 Ranking de Atividade', value: topUsers.map((u, i) => `> **${i+1}.** \`${u.tag}\` — *${u.count} msgs*`).join('\n') || '*Sem dados.*', inline: false },
                    { name: '🗣️ Termos Dominantes', value: topWords.map((w, i) => `> **${i+1}.** \`${w[0]}\` — *repetido ${w[1]}x*`).join('\n') || '*Sem dados.*', inline: false }
                ])
                .setTimestamp()
                .setFooter({ text: `Nero Engine Core v${BOT_VERSION}`, iconURL: client.user.displayAvatarURL() });

            return interaction.editReply({ embeds: [embedNeural] });
        } catch (e) {
            return interaction.editReply({ embeds: [criarEmbedBase('❌ Falha Crítica', `Erro no processador neural: \`${e.message}\``, '#FF0000')] });
        }
    }
});

process.on('unhandledRejection', async (reason) => {
    terminalLog('error', `Rejeição não tratada: ${reason}`);
    await enviarDM("Falha de Execução Interna", `Erro detectado:\n${reason}`, '#FF0000');
});

client.login(TOKEN);
