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

// Função Gemini robusta com suporte a histórico estruturado e prompt de IA inteligente
async function perguntarParaIA(promptTexto, historicoAnterior = []) {
    if (!GEMINI_API_KEY) throw new Error("Chave GEMINI_API_KEY ausente.");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    // Monta o corpo seguindo o padrão correto exigido pela API do Gemini
    const contents = [];
    
    // Adiciona o histórico se houver
    historicoAnterior.forEach(msg => {
        contents.push({
            role: msg.role,
            parts: [{ text: msg.text }]
        });
    });
    
    // Adiciona a pergunta atual
    contents.push({
        role: "user",
        parts: [{ text: promptTexto }]
    });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: contents,
            systemInstruction: {
                parts: [{ text: "Você é o Nero/NaniBot, um assistente virtual altamente inteligente, autêntico, adaptável e com um toque de sagacidade. Fale de igual para igual, de forma direta, clara e prestativa. Evite respostas robóticas, seja foda e use gírias naturais se o usuário também usar." }]
            }
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Erro HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Rapaz, processei tudo aqui mas veio uma resposta vazia. Tenta de novo!";
}

async function enviarDM(titulo, message, cor) {
    try {
        if (!OWNER_ID) return;
        const owner = await client.users.fetch(OWNER_ID);
        const embed = new EmbedBuilder().setColor(cor || '#2C2A4A').setTitle(titulo).setDescription(message).setTimestamp();
        await owner.send({ embeds: [embed] });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('NaniBot online'); }).listen(PORT);

client.on('ready', async () => {
    terminalLog('success', `Online em: ${client.user.tag}`);
    await enviarDM("🚀 Sistema Online", `Nero conectado com sucesso. IA integrada e pronta!`, '#00FF00');

    const commands = [
        new SlashCommandBuilder().setName('limpar').setDescription('Deleta mensagens.').addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true))
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

    // Verifica se o bot foi marcado OU se responderam a uma mensagem dele
    const foiMarcado = message.mentions.has(client.user) && !message.content.includes('@everyone') && !message.content.includes('@here');
    const ehRespostaAoBot = message.reference && (await message.channel.messages.fetch(message.reference.messageId)).author.id === client.user.id;

    if (foiMarcado || ehRespostaAoBot) {
        try {
            await message.channel.sendTyping();
            
            let historico = [];
            let textoLimpo = message.content.replace(`<@${client.user.id}>`, '').trim();

            // Lógica de Memória: se for resposta a uma mensagem do bot, resgata o contexto
            if (message.reference) {
                try {
                    const msgAntiga = await message.channel.messages.fetch(message.reference.messageId);
                    if (msgAntiga) {
                        // Se a mensagem que você respondeu veio do bot, coloca como modelo de chat anterior
                        if (msgAntiga.author.id === client.user.id) {
                            historico.push({ role: "user", text: "Mensagem anterior enviada no chat" });
                            historico.push({ role: "model", text: msgAntiga.content });
                        } else {
                            historico.push({ role: "user", text: msgAntiga.content });
                        }
                    }
                } catch (errHistory) {
                    terminalLog('warn', 'Não foi possível buscar a mensagem de referência do histórico.');
                }
            }

            // Busca resposta inteligente na API
            const respostaIa = await perguntarParaIA(textoLimpo, historico);
            return message.reply(respostaIa);

        } catch (err) {
            terminalLog('error', `Erro na requisição da IA: ${err.message}`);
            await enviarDM("❌ Falha crítica no Gemini API", `Erro gerado: ${err.message}\nVerifique se o seu TOKEN e a sua GEMINI_API_KEY estão corretos no painel da Render.`, '#FF0000');
            return message.reply("Cara, deu um problema aqui para me conectar com a minha IA. Avisando o dono no privado para verificar o painel.");
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === 'limpar') {
        const qtd = options.getInteger('quantidade');
        await interaction.channel.bulkDelete(Math.min(qtd, 100), true);
        return interaction.reply({ content: `🧹 Eliminadas ${qtd} mensagens do histórico.`, ephemeral: true });
    }
});

client.login(TOKEN);
