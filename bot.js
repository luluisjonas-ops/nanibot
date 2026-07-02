const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const backup = require('discord-backup');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_VERSION = "1.1.0"; 

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
let config = { autoroleId: null, usuariosAgurdando: [], ultimoBackupId: null, warns: {}, warnLimit: 3, logsChannelId: null, filtroXingamentosAtivo: true };

try { if (fs.existsSync(DATA_FILE)) { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); config = { ...config, ...saved }; } } catch (e) {}
function saveConfig() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 4)); } catch(e) {} }

function terminalLog(level, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
}

function isOwner(userId) { return userId === OWNER_ID; }

// CORRIGIDO: Agora usa a variável correta (embedsExtras) sem quebrar o envio
async function enviarDM(titulo, message, cor, embedsExtras = []) {
    try {
        if (!OWNER_ID) return terminalLog('warn', 'OWNER_ID não configurado no arquivo .env.');
        const owner = await client.users.fetch(OWNER_ID, { force: true });
        const embed = new EmbedBuilder().setColor(cor || '#0B0A14').setTitle(titulo).setDescription(message).setTimestamp();
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
    // Dispara a DM de atualização (agora sem travar no erro interno)
    await enviarDM("🚀 Status do Sistema", `Nero atualizado com sucesso para a versão \`v${BOT_VERSION}\`.`, '#00FF00');

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

// Tratamento global de erros para capturar falhas de execução e te avisar na DM de forma limpa
process.on('unhandledRejection', async (reason) => {
    terminalLog('error', `Rejeição não tratada: ${reason}`);
    await enviarDM("❌ Falha de Execução Interna", `**Erro detectado:**\n\`\`\`text\n${reason}\n\`\`\``, '#FF0000');
});

client.login(TOKEN);
