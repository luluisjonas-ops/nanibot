const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
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

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('NaniBot online');
}).listen(PORT, () => {
    terminalLog('info', `Servidor HTTP de keep-alive rodando na porta ${PORT}`);
});

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

    await enviarDM(
        '🔄 NaniBot Atualizado & Online',
        `O bot foi atualizado e está online!\n\n**Tag:** \`${client.user.tag}\`\n**Servidores:** \`${client.guilds.cache.size}\`\n**Horário:** \`${new Date().toLocaleString('pt-BR')}\``,
        '#2C2A4A'
    );

    const commands = [
        new SlashCommandBuilder().setName('autorole').setDescription('Define cargo automático e aplica em todos do server.').addRoleOption(o => o.setName('cargo').setDescription('Cargo Automático').setRequired(true)),
        new SlashCommandBuilder().setName('setup-server').setDescription('Monta a infraestrutura gótica blindada com regras, calls variadas e VIP.'),
        new SlashCommandBuilder().setName('ban').setDescription('Bane um membro do servidor.').addUserOption(o => o.setName('membro').setDescription('Membro a ser banido').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Motivo do ban')),
        new SlashCommandBuilder().setName('mute').setDescription('Aplica castigo temporário em um membro.').addUserOption(o => o.setName('membro').setDescription('Membro').setRequired(true)).addIntegerOption(o => o.setName('tempo').setDescription('Tempo em minutos').setRequired(true)),
        new SlashCommandBuilder().setName('limpar').setDescription('Deleta mensagens de um canal.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade de mensagens (1-100)').setRequired(true)),
        new SlashCommandBuilder().setName('apelido').setDescription('Altera o apelido de um membro no servidor.').addUserOption(o => o.setName('membro').setDescription('Membro alvo').setRequired(true)).addStringOption(o => o.setName('novo-apelido').setDescription('Novo apelido (deixe vazio para resetar)').setRequired(false)),
        new SlashCommandBuilder().setName('salvar-servidor').setDescription('Gera um clone completo do servidor.'),
        new SlashCommandBuilder().setName('carregar-servidor').setDescription('Apaga tudo e carrega a cópia completa do servidor salva anteriormente.')
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(client.token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        client.guilds.cache.forEach(async (guild) => {
            try { await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands }); } catch(e) {}
        });
        terminalLog('success', 'Injeção limpa concluída! Sem duplicações de comandos Slash.');
    } catch (e) { terminalLog('error', `Erro nos comandos: ${e.message}`); }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const virouBooster = !oldMember.premiumSince && newMember.premiumSince;
    if (virouBooster) {
        const guild = newMember.guild;
        const cargoVip = guild.roles.cache.find(r => r.name === '专 VIP Member');
        const canalNero = guild.channels.cache.find(c => c.name === './/nero');
        if (cargoVip) await newMember.roles.add(cargoVip).catch(() => {});
        if (canalNero) {
            const embedBoost = new EmbedBuilder()
                .setColor('#2C2A4A')
                .setTitle('🔮 Novo Impulso de Energia (Boost)')
                .setDescription(`O usuário ${newMember} interceptou o sistema e ativou um Boost no servidor.`)
                .addFields(
                    { name: 'Identificação', value: `\`${newMember.user.tag}\``, inline: true },
                    { name: 'Cargo Concedido', value: `\`专 VIP Member\``, inline: true }
                )
                .setTimestamp();
            await canalNero.send({ embeds: [embedBoost] });
        }
    }
});

client.on('guildMemberAdd', async (member) => {
    if (config.autoroleId) {
        try {
            const role = member.guild.roles.cache.get(config.autoroleId);
            if (role) await member.roles.add(role);
        } catch (e) {}
    }
});

client.on('interactionCreate', async interaction => {

    if (interaction.isButton()) {
        const { customId, member, guild } = interaction;

        if (customId === 'solicitar_verificacao') {
            if (config.usuariosAgurdando && config.usuariosAgurdando.includes(member.id)) {
                return interaction.reply({ content: 'Seu pedido já foi enviado. Aguarde análise.', ephemeral: true });
            }
            const canalLogs = guild.channels.cache.find(c => c.name === 'staff-gate');
            if (!canalLogs) {
                return interaction.reply({ content: 'Erro fatal: Canal dos staffs não encontrado.', ephemeral: true });
            }
            if (!config.usuariosAgurdando) config.usuariosAgurdando = [];
            config.usuariosAgurdando.push(member.id);
            saveConfig();
            await interaction.reply({ content: '✦ Solicitação registrada. O acesso está pendente de aprovação.', ephemeral: true });
            const embedAdm = new EmbedBuilder()
                .setColor('#0F0F10')
                .setTitle('⚖️ Verificação Pendente')
                .setDescription(`O usuário ${member} solicitou entrada oficial no servidor.`)
                .addFields(
                    { name: 'Conta', value: `\`${member.user.tag}\``, inline: true },
                    { name: 'ID Único', value: `\`${member.id}\``, inline: true }
                )
                .setTimestamp();
            const botoesAdm = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`aprovar_${member.id}`).setLabel('✦ Permitir').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`recusar_${member.id}`).setLabel('☠ Barrar').setStyle(ButtonStyle.Danger)
            );
            await canalLogs.send({ embeds: [embedAdm], components: [botoesAdm] });
            return;
        }

        if (interaction.user.id !== guild.ownerId && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Você não tem hierarquia para usar este botão.', ephemeral: true });
        }

        if (customId.startsWith('aprovar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                const cargoMembro = guild.roles.cache.find(r => r.name === 'user');
                if (cargoMembro) await alvo.roles.add(cargoMembro);
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                const embedSucesso = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#1C1A27')
                    .setTitle('✓ Acesso Liberado')
                    .setDescription(`Liberado por: ${interaction.user}`);
                await interaction.message.edit({ embeds: [embedSucesso], components: [] });
            } catch (e) {
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
            }
        }

        if (customId.startsWith('recusar_')) {
            await interaction.deferUpdate();
            const userId = customId.split('_')[1];
            try {
                const alvo = await guild.members.fetch(userId);
                await alvo.kick('Barrado no Gate.');
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
                const embedRecusado = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#0A0A0A')
                    .setTitle('☠ Barrado e Expulso')
                    .setDescription(`Rejeitado por: ${interaction.user}`);
                await interaction.message.edit({ embeds: [embedRecusado], components: [] });
            } catch (e) {
                config.usuariosAgurdando = config.usuariosAgurdando.filter(id => id !== userId); saveConfig();
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = interaction;

    if (interaction.user.id !== guild.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: 'Você não consegue usar comando Filho da puta', ephemeral: true });
    }

    if (commandName === 'autorole') {
        await interaction.deferReply({ ephemeral: true });
        const cargo = options.getRole('cargo');
        if (guild.members.me.roles.highest.position <= cargo.position) {
            return interaction.editReply({ content: 'Erro de hierarquia de cargos do bot.' });
        }
        config.autoroleId = cargo.id; saveConfig();
        return interaction.editReply({ content: `Cargo inicial padrão updated para: ${cargo.name}` });
    }

    if (commandName === 'ban') {
        const alvo = options.getUser('membro');
        const motivo = options.getString('motivo') || 'Banido por infração de regras.';
        try {
            await guild.members.ban(alvo, { reason: motivo });
            return interaction.reply({ content: `⚔️ **${alvo.tag}** foi banido com sucesso.\nMotivo: ${motivo}` });
        } catch (e) { return interaction.reply({ content: `Erro: Permissões insuficientes.`, ephemeral: true }); }
    }

    if (commandName === 'mute') {
        const alvo = options.getMember('membro');
        const tempo = options.getInteger('tempo');
        try {
            await alvo.timeout(tempo * 60 * 1000, 'Castigado por staff.');
            return interaction.reply({ content: `⚖️ ${alvo} foi silenciado por ${tempo} minutes.` });
        } catch (e) { return interaction.reply({ content: `Erro ao aplicar timeout.`, ephemeral: true }); }
    }

    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        try {
            const deletadas = await channel.bulkDelete(qtd, true);
            return interaction.reply({ content: `Sumi com ${deletadas.size} mensagens desse canal.`, ephemeral: true });
        } catch (e) { return interaction.reply({ content: `Erro ao limpar chat.`, ephemeral: true }); }
    }

    if (commandName === 'apelido') {
        const alvo = options.getMember('membro');
        const novoApelido = options.getString('novo-apelido') || null;
        try {
            await alvo.setNickname(novoApelido);
            return interaction.reply({ content: `Apelido updated.`, ephemeral: true });
        } catch (e) { return interaction.reply({ content: `Erro de hierarquia.`, ephemeral: true }); }
    }

    if (commandName === 'salvar-servidor') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const dadosBackup = await backup.create(guild, {
                maxMessagesPerChannel: 20,
                jsonSave: true,
                jsonName: 'servidor_backup_completo'
            });
            config.ultimoBackupId = dadosBackup.id;
            saveConfig();
            return interaction.editReply({ content: `Server backup criado com sucesso! ID: ${dadosBackup.id}` });
        } catch (e) { return interaction.editReply({ content: `Falha: ${e.message}` }); }
    }

    if (commandName === 'carregar-servidor') {
        if (!config.ultimoBackupId) {
            return interaction.reply({ content: 'Erro: Nenhum backup salvo.', ephemeral: true });
        }
        await interaction.reply({ content: 'Aviso: Alinhando restauração total de ativos...', ephemeral: true });
        try {
            await backup.load(config.ultimoBackupId, guild, { clearGuildBeforeRestore: true });
            terminalLog('success', 'Estrutura restaurada via biblioteca.');
        } catch (e) { terminalLog('error', `Erro crítico: ${e.message}`); }
        return;
    }

    if (commandName === 'setup-server') {
        if (interaction.user.id !== guild.ownerId) {
            return interaction.reply({ content: 'Apenas o Dono Absoluto do servidor pode reconstruir a infraestrutura.', ephemeral: true });
        }

        await interaction.reply({ content: '⚙️ Iniciando limpeza total e blindagem de canais...', ephemeral: true });

        const antigos = await guild.channels.fetch();
        for (const [id, c] of antigos) { try { await c.delete(); } catch(e){} }

        const cargosAntigos = await guild.roles.fetch();
        for (const [id, r] of cargosAntigos) {
            if (!r.managed && r.id !== guild.roles.everyone.id) { try { await r.delete(); } catch(e){} }
        }

        await guild.roles.everyone.setPermissions([PermissionFlagsBits.ReadMessageHistory]);

        const cargoMembro = await guild.roles.create({
            name: 'user', color: '#555555',
            permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        });
        config.autoroleId = cargoMembro.id; saveConfig();

        const cargoVip = await guild.roles.create({
            name: '专 VIP Member', color: '#2C2A4A', hoist: true,
            permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        });

        const cargoDono = await guild.roles.create({ name: '👑 Server Owner', color: '#010101', hoist: true, permissions: [PermissionFlagsBits.Administrator] });
        const cargoCoOwner = await guild.roles.create({ name: '🔱 Co-Owner', color: '#090A0C', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoDirector = await guild.roles.create({ name: '✦ Senior Director', color: '#121417', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoAdmin = await guild.roles.create({ name: '🛡️ Administrator', color: '#1B1E22', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });

        const cargoSrMod = await guild.roles.create({ name: '⚖️ Senior Moderator', color: '#25292F', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] });
        const cargoMod = await guild.roles.create({ name: '⚔️ Moderator', color: '#2F343C', hoist: true, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] });
        const cargoInspector = await guild.roles.create({ name: '👁️ Inspector', color: '#3A404A', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoHelper = await guild.roles.create({ name: '⚡ Staff Helper', color: '#464D59', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoSupport = await guild.roles.create({ name: '⚙️ Support Team', color: '#525B69', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });
        const cargoTrial = await guild.roles.create({ name: '⏳ Support Trial', color: '#606978', hoist: true, permissions: [PermissionFlagsBits.ViewChannel] });

        const idsStaff = [cargoCoOwner.id, cargoDirector.id, cargoAdmin.id, cargoSrMod.id, cargoMod.id, cargoInspector.id, cargoHelper.id, cargoSupport.id, cargoTrial.id, cargoDono.id];

        await interaction.member.roles.add(cargoDono).catch(()=>{});

        const listaCargosEmo = [
            { name: '专 Midnight Lost', color: '#0A0A0A' }, { name: '♰ Bleeding Heart', color: '#141414' },
            { name: '☠ Darkened Soul', color: '#1A1A1A' }, { name: '✧ Silent Tears', color: '#222222' },
            { name: '⚰ Final Eclipse', color: '#2B2B2B' }, { name: '专 Vampiric Kiss', color: '#333333' },
            { name: '♰ Emo Forever', color: '#3A3A3A' }, { name: '🖤 Broken Faith', color: '#444444' },
            { name: '☠ Rotten Rose', color: '#4D4D4D' }, { name: '✧ Goth Vibe', color: '#555555' },
            { name: '⚰ Dead Memory', color: '#1C1C1C' }, { name: '专 Shadow Walker', color: '#252525' },
            { name: '♰ Hollow Shell', color: '#2E2E2E' }, { name: '🖤 Toxic Poison', color: '#373737' },
            { name: '☠ Suicide Love', color: '#3F3F3F' }, { name: '✧ Cold Reality', color: '#484848' },
            { name: '⚰ Last Breath', color: '#515151' }, { name: '专 Black Parade', color: '#1F2421' },
            { name: '♰ Cemetery Gates', color: '#212529' }, { name: '🖤 Scars Inside', color: '#343A40' },
            { name: '☠ Funeral Dress', color: '#495057' }, { name: '✧ Lonely Ghost', color: '#0F0F10' },
            { name: '⚰ Crow Sorrow', color: '#18191A' }, { name: '专 Velvet Agony', color: '#242526' },
            { name: '♰ Gothic Nightmare', color: '#3A3B3C' }, { name: '🖤 Misery Business', color: '#111111' },
            { name: '☠ Bleak Winter', color: '#1C1A27' }, { name: '✧ Orphan Tears', color: '#232135' },
            { name: '⚰ Wasted Youth', color: '#2C2A4A' }, { name: '专 Eternal Abyss', color: '#0D0C1D' }
        ];
        for (const c of listaCargosEmo) { try { await guild.roles.create({ name: c.name, color: c.color }); } catch (e) {} }

        const catPortaria = await guild.channels.create({ name: 'GATEWAY', type: ChannelType.GuildCategory });

        const canalVerificar = await guild.channels.create({
            name: 'gate', type: ChannelType.GuildText, parent: catPortaria.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
                { id: cargoMembro.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });

        const overwritesStaffCanais = [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: cargoMembro.id, deny: [PermissionFlagsBits.ViewChannel] }
        ];
        idsStaff.forEach(id => {
            overwritesStaffCanais.push({ id: id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        });

        await guild.channels.create({
            name: 'staff-gate', type: ChannelType.GuildText, parent: catPortaria.id,
            permissionOverwrites: overwritesStaffCanais
        });

        const catInfo = await guild.channels.create({ name: 'INFORMATION', type: ChannelType.GuildCategory });

        const canalRegras = await guild.channels.create({
            name: 'rules', type: ChannelType.GuildText, parent: catInfo.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }
            ]
        });

        const catStaff = await guild.channels.create({ name: 'STAFF CONTROL', type: ChannelType.GuildCategory });

        await guild.channels.create({
            name: 'staff-chat', type: ChannelType.GuildText, parent: catStaff.id,
            permissionOverwrites: overwritesStaffCanais
        });

        const overwritesCallStaff = [
            { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }
        ];
        idsStaff.forEach(id => {
            overwritesCallStaff.push({ id: id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        });

        await guild.channels.create({
            name: '🔱 Management Room', type: ChannelType.GuildVoice, parent: catStaff.id,
            permissionOverwrites: overwritesCallStaff
        });

        const catNero = await guild.channels.create({ name: 'NERO SYSTEM', type: ChannelType.GuildCategory });

        const overwritesNeroCall = [
            { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: cargoDono.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
        ];
        idsStaff.forEach(id => {
            if (id !== cargoDono.id) {
                overwritesNeroCall.push({ id: id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] });
            }
        });

        await guild.channels.create({
            name: './/Nero', type: ChannelType.GuildVoice, parent: catNero.id,
            permissionOverwrites: overwritesNeroCall
        });

        const catChat = await guild.channels.create({ name: 'TEXT DIRECTORY', type: ChannelType.GuildCategory });
        const canaisChat = ['announcements', 'sms', 'bot-commands', 'media'];
        for (const name of canaisChat) {
            await guild.channels.create({
                name: name, type: ChannelType.GuildText, parent: catChat.id,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });
        }

        const catVozGeral = await guild.channels.create({ name: 'VOICE DIRECTORY', type: ChannelType.GuildCategory });
        const salasSemLimite = ['Lounge 01', 'Lounge 02'];
        for (const name of salasSemLimite) {
            await guild.channels.create({
                name: name, type: ChannelType.GuildVoice, parent: catVozGeral.id,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
                ]
            });
        }

        const catRomance = await guild.channels.create({ name: '🖤 ROMANCE & PRIVATE', type: ChannelType.GuildCategory });
        const salasDuplas = ['🖤 Private Room 01', '🖤 Private Room 02'];
        for (const name of salasDuplas) {
            await guild.channels.create({
                name: name, type: ChannelType.GuildVoice, parent: catRomance.id, userLimit: 2,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
                ]
            });
        }

        const catGaming = await guild.channels.create({ name: '🎮 GAMING SQUADS', type: ChannelType.GuildCategory });
        const salasSquad = ['🎮 Squad Lobby 01', '🎮 Squad Lobby 02'];
        for (const name of salasSquad) {
            await guild.channels.create({
                name: name, type: ChannelType.GuildVoice, parent: catGaming.id, userLimit: 10,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
                ]
            });
        }

        const catVipSector = await guild.channels.create({ name: '💎 PREMIUM SECTOR', type: ChannelType.GuildCategory });
        const overwritesCallVip = [
            { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: cargoMembro.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: cargoVip.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
        ];
        idsStaff.forEach(id => {
            overwritesCallVip.push({ id: id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
        });

        await guild.channels.create({
            name: '💎 VIP Lounge', type: ChannelType.GuildVoice, parent: catVipSector.id,
            permissionOverwrites: overwritesCallVip
        });

        const embedPortaria = new EmbedBuilder()
            .setColor('#0A0A0A')
            .setTitle('✦ GATEWAY INTEGRITY')
            .setDescription('Para acessar os diretórios e canais protegidos da comunidade, clique no mecanismo de entrada abaixo.\n\n*A aprovação passará pela triagem dos moderadores.*');

        const rowBotao = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('solicitar_verificacao').setLabel('✦ Request Access').setStyle(ButtonStyle.Secondary)
        );

        await canalVerificar.send({ embeds: [embedPortaria], components: [rowBotao] });

        const embedRegras = new EmbedBuilder()
            .setColor('#0A0A0A')
            .setTitle('♰ SERVERS DIRECTIVES & CODEX')
            .setDescription('O cumprimento destas diretrizes garante a permanência e a ordem dentro dos diretórios criptografados desta comunidade.')
            .addFields(
                { name: '§ 1. CONDUTA E INTEGRIDADE', value: '• **Respeito Mútuo:** Ataques diretos, assédio persistente e condutas difamatórias resultarão em banimento sumário.' },
                { name: '§ 2. DIRETÓRIOS DE CHAT E CONTEÚDO', value: '• **Spam / Flood:** É proibida a poluição visual de canais textuais através do envio massivo de caracteres ou links.' },
                { name: '§ 3. SISTEMA DE VOZ E TRANSMISSÃO', value: '• **Poluição Sonora:** Ruídos excessivos, moduladores irritantes ou gritos nas salas públicas ocasionarão o bloqueio imediato do seu canal de fala.' },
                { name: '§ 4. BENEFÍCIOS DO COLOFON', value: '• **Boost Ativo:** Impulsione o servidor para descriptografar o cargo VIP automático e ganhar privilégios exclusivos nos canais e salas criptografadas.' }
            )
            .setFooter({ text: 'Nero System Enforcement • Diretrizes Atualizadas' })
            .setTimestamp();

        await canalRegras.send({ embeds: [embedRegras] });

        terminalLog('success', 'Infraestrutura completa com divisões de categorias de voz e chat montada.');
    }
});

const ERROS_IGNORADOS = ['Unknown interaction', 'Unknown Message', 'Missing Access', 'Cannot send messages to this user'];

process.on('unhandledRejection', (error) => {
    if (ERROS_IGNORADOS.some(e => error.message?.includes(e))) {
        terminalLog('warn', `Erro ignorado (normal): ${error.message}`);
        return;
    }
    terminalLog('error', `Erro não tratado: ${error.message}`);
    enviarDM('❌ Erro no NaniBot', `**Tipo:** Unhandled Rejection\n**Mensagem:** \`${error.message}\``, '#FF0000');
});

process.on('uncaughtException', (error) => {
    if (ERROS_IGNORADOS.some(e => error.message?.includes(e))) {
        terminalLog('warn', `Erro ignorado (normal): ${error.message}`);
        return;
    }
    terminalLog('error', `Exceção não capturada: ${error.message}`);
    enviarDM('💥 Exceção Crítica no NaniBot', `**Tipo:** Uncaught Exception\n**Mensagem:** \`${error.message}\``, '#FF0000');
});
