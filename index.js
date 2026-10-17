/**
 * Colmeia Bot — Filas 1x1 / 2x2 / 3x3 / 4x4
 * -------------------------------------------------
 * Painéis de fila:
 *  - Comandos: !painel1x1, !painel2x2, !painel3x3, !painel4x4.
 *  - Variante opcional depois do formato: "misto" ou "emu"
 *    (ex.: "!painel1x1 misto", "!painel4x4 emu") — só muda o rótulo.
 *  - Valor opcional depois (ou depois da variante), aceita vários
 *    separados por PONTO pra criar uma aba/painel pra cada um (não
 *    vírgula, porque a vírgula já é usada pro centavo, ex: R$2,00):
 *      "!painel1x1 R$2,00"
 *      "!painel1x1 misto R$2,00.R$4,00"   -> 2 painéis independentes
 *      "!painel4x4 emu 2.4.6"              -> 3 painéis independentes
 *  - Cada painel tem sua própria fila (Gel Normal / Gel Inf) e só fecha
 *    quando atinge a capacidade do formato (1x1=2, 2x2=4, 3x3=6, 4x4=8
 *    jogadores). Hoje o mediador define UM vencedor entre todos os
 *    jogadores da partida (não há separação em "times" na hora de
 *    escolher o vencedor).
 *  1) Fila fecha -> cria TÓPICO PRIVADO "aguandando-<numero>",
 *     adiciona todos os jogadores, manda embed com Confirmar/Cancelar.
 *  2) Quando todos confirmam:
 *       - some os botões de confirmar/cancelar
 *       - pega o PRIMEIRO mediador da fila de mediadores (veja abaixo)
 *       - manda a "ficha da partida": Jogadores, Mediador, Formato,
 *         Taxa de Inscrição — com botões Regras / QR / Cancelar, e um
 *         menu de seleção com a opção "Finalizar Aposta"
 *       - manda o bloco de Valor + Chave Pix do mediador
 *       - manda o aviso "MUDOU A FORMA DE MOSTRAR A TELA"
 *  3) "Finalizar Aposta" (só cargo mediador) -> select pra escolher o
 *     vencedor -> select "Vencedor por W.O." ou "Vencedor por Vitória"
 *     -> manda a mensagem de partida encerrada, registra a vitória no
 *     ranking do jogador e o ganho do mediador no ranking-adm.
 *  4) Botão "Cancelar" (em qualquer etapa) faz a contagem regressiva,
 *     remove os jogadores do tópico e exclui o tópico.
 *
 * Fila de mediadores (!painelmediador) segue o padrão Entrar/Sair
 * (FIFO), com cargo configurável (MEDIADOR_ROLE_ID). Só quem tem o
 * cargo de mediador pode usar as opções de finalizar a fila.
 *
 * Cadastro de mediador (!painelpix): autosserviço com validação da
 * chave Pix (e-mail/CPF/CNPJ/telefone/chave aleatória) — se algo
 * estiver errado o bot avisa o motivo. Admins também podem cadastrar
 * manualmente com !addmediador, !removermediador e !listamediadores.
 *
 * Acesso de Mediador por comando (sem precisar dar o cargo no
 * Discord): !addmediadoracesso @pessoa, !removermediadoracesso @pessoa
 * e !listamediadoresacesso — só o CEO/dono pode usar. Dá acesso a
 * Cancelar/Finalizar Aposta/Escolher Vencedor em qualquer partida, na
 * hora, sem reiniciar o bot.
 *
 * Rankings:
 *  - !painelranking      -> vitórias dos jogadores (Meu Perfil / Ranking).
 *  - !painelrankingadm   -> horas na fila + ganhos (R$0,50/fila) dos
 *    mediadores, com top semanal/mensal/total e coroa no 1º lugar.
 *
 * Requisitos:
 *   npm install discord.js qrcode
 *
 * Configuração (variáveis de ambiente recomendadas):
 *   DISCORD_TOKEN         -> token do bot
 *   VALOR_APOSTA           -> ex: "R$1,00" (Taxa de Inscrição padrão,
 *                             usada quando o painel é criado sem valor)
 *   ACRESCIMO_MEDIADOR      -> ex: "0.50" (acréscimo pago ao mediador
 *                             sobre o valor da fila; também é o ganho
 *                             registrado no ranking-adm por fila)
 *   REGRAS_URL             -> link pro canal/página de regras
 *   TUTORIAL_URL            -> link pro tutorial de cadastro de Pix
 *   MEDIADOR_ROLE_ID        -> ID do cargo que pode entrar na fila de
 *                             mediadores e finalizar apostas (vazio =
 *                             qualquer pessoa)
 *   DONO_USER_ID            -> ID de USUÁRIO (não de cargo) que sempre
 *                             tem acesso total de CEO/Mediador, mesmo
 *                             que o cargo dele esteja mal configurado.
 *                             "Acesso de emergência" (vazio = desativado).
 *                             Só existe UM dono fixo.
 *
 * Os dados ficam salvos em arquivos .json na mesma pasta do bot:
 * mediadores.json, ranking.json, ranking-adm.json
 * — não precisa editar código pra isso.
 */

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const QRCode = require('qrcode');
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

// ------------------- CONFIG -------------------
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN || 'SEU_TOKEN_AQUI';
const VALOR_APOSTA_PADRAO = process.env.VALOR_APOSTA || 'R$1,00'; // Taxa de Inscrição (valor padrão, usado quando "!painelXxX" é chamado sem valor)

// Converte "R$2,00" -> 2.00 (número). Retorna null se não conseguir entender.
function parseValorBR(texto) {
  if (!texto) return null;
  const limpo = texto.replace(/[^\d,\.]/g, '').replace(',', '.');
  const numero = parseFloat(limpo);
  return isNaN(numero) ? null : numero;
}

// Converte 2.5 -> "R$2,50"
function formatarValorBR(numero) {
  return `R$${numero.toFixed(2).replace('.', ',')}`;
}

// Valor pago ao mediador = valor da fila (de um painel específico) +
// acréscimo. Se o valor não puder ser entendido como número, cai no
// valor padrão + acréscimo.
function calcularValorMediador(valorFila) {
  const valorFilaNumero = parseValorBR(valorFila);
  const base = valorFilaNumero !== null ? valorFilaNumero : (parseValorBR(VALOR_APOSTA_PADRAO) || 0);
  return formatarValorBR(base + ACRESCIMO_MEDIADOR);
}
// Valor pago ao mediador = valor da fila + um acréscimo fixo (calculado
// automaticamente). Configure o acréscimo em ACRESCIMO_MEDIADOR (em
// reais, use ponto: "0.50" = 50 centavos). Esse mesmo valor também é o
// ganho registrado no ranking-adm por fila finalizada.
const ACRESCIMO_MEDIADOR = parseFloat(process.env.ACRESCIMO_MEDIADOR || '0.50');
const NOME_ORG = 'Colmeia';
const COR_AMARELA = 0xF1C40F;

// ---------- FORMATOS DE PAINEL (1x1 / 2x2 / 3x3 / 4x4) ----------
// capacidade = total de jogadores necessários pra fechar a fila (soma
// dos dois lados). Ex.: 2x2 -> 2 jogadores de cada time -> 4 no total.
const FORMATOS = {
  '1x1': { capacidade: 2 },
  '2x2': { capacidade: 4 },
  '3x3': { capacidade: 6 },
  '4x4': { capacidade: 8 },
};

// Variantes aceitas depois do formato, ex: "!painel1x1 misto" ou
// "!painel4x4 emu". Só muda o rótulo mostrado no painel, a mecânica é
// a mesma.
const VARIANTES_VALIDAS = ['misto', 'emu'];

// Sem variante: "1x1 Mobile". Com variante (misto/emu): some o "Mobile"
// e usa o nome escolhido no lugar, ex: "1x1 Misto", "4x4 Emu".
function montarRotuloFormato(formatoChave, variante) {
  if (!variante) return `${formatoChave} Mobile`;
  const nomeVariante = variante.charAt(0).toUpperCase() + variante.slice(1);
  return `${formatoChave} ${nomeVariante}`;
}

// Cada painel postado (!painel1x1, !painel2x2 ...) vira uma instância
// independente aqui dentro, indexada por um ID curto. Isso permite ter
// várias "abas" de valores diferentes ao mesmo tempo (ex.:
// "!painel1x1 R$2,00.R$4,00" cria 2 painéis independentes, um pra
// R$2,00 e outro pra R$4,00), sem misturar jogadores de uma aba com os
// de outra.
//
// Fica salvo em arquivo (paineis-fila.json) pra sobreviver a reinícios
// do bot — sem isso, todo painel já postado "morria" (dava erro "Esse
// painel não existe mais") toda vez que o bot reiniciava.
const CAMINHO_PAINEIS_FILA = path.join(__dirname, 'paineis-fila.json');

function carregarPaineisFila() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_PAINEIS_FILA, 'utf-8');
    return new Map(JSON.parse(conteudo));
  } catch (err) {
    return new Map();
  }
}

function salvarPaineisFila() {
  fs.writeFileSync(CAMINHO_PAINEIS_FILA, JSON.stringify(Array.from(painelInstancias.entries()), null, 2), 'utf-8');
}

const painelInstancias = carregarPaineisFila();
let contadorPainel = 0;
function novoIdPainel() {
  contadorPainel += 1;
  return `p${contadorPainel}${Date.now().toString(36).slice(-4)}`;
}

// Define as "filas" (abas de entrada) de um painel:
//  - Padrão (sem variante, ou variante "emu") e sempre no 1x1: as duas
//    filas de sempre, "Gel Normal" e "Gel Inf".
//  - Variante "misto" no 2x2/3x3/4x4: em vez de Gel Normal/Gel Inf,
//    usa N filas "1 Emu", "2 Emu"... (N = capacidade/2 - 1), ou seja
//    2x2 misto = só "1 Emu", 3x3 misto = "1 Emu"/"2 Emu", 4x4 misto =
//    "1 Emu"/"2 Emu"/"3 Emu". Cada fila funciona exatamente como antes:
//    fecha sozinha ao atingir a capacidade do formato.
function definirFilasInstancia(formatoChave, variante) {
  if (formatoChave === '1x1') {
    return [
      { key: 'normal', label: 'Gel Normal', tipo: 'gel' },
      { key: 'inf', label: 'Gel Inf', tipo: 'gel' },
    ];
  }

  if (variante === 'misto') {
    const numFilas = FORMATOS[formatoChave].capacidade / 2 - 1;
    const filas = [];
    for (let i = 1; i <= numFilas; i++) {
      filas.push({ key: `emu${i}`, label: `${i} Emu`, tipo: 'emu' });
    }
    return filas;
  }

  // 2x2/3x3/4x4 sem variante misto: fila única, só Entrar/Sair.
  return [{ key: 'unica', label: 'Jogadores', tipo: 'unica' }];
}

function criarInstanciaPainel(formatoChave, variante, valor) {
  const id = novoIdPainel();
  const filasDef = definirFilasInstancia(formatoChave, variante);
  const filas = {};
  for (const f of filasDef) filas[f.key] = [];

  const instancia = {
    id,
    formatoChave,
    variante,
    rotuloFormato: montarRotuloFormato(formatoChave, variante),
    // Mínimo pra fechar a fila e confirmar a sala: sempre 2 pessoas,
    // em qualquer formato (1x1/2x2/3x3/4x4) e variante (misto/emu).
    capacidade: 2,
    valor,
    filasDef,
    filas,
  };
  painelInstancias.set(id, instancia);
  salvarPaineisFila();
  return instancia;
}

// ---------- IMAGENS (hospedadas fora do Google Drive, que não expõe
// link direto de imagem) ----------
const IMG_TROFEU = 'https://kommodo.ai/i/JCELExrRiRmbJRlcG49d';
const IMG_COROA_URL = 'https://kommodo.ai/i/CVP9M0WQgcrtuyxTQexJ';
const IMG_BOTAO_RANKING = 'https://kommodo.ai/i/jkzw2KFaoMswTYzSylAU';
const IMG_GELO = 'https://kommodo.ai/i/DRghn4dYxdbsAtbjuOZV';
const IMG_BOTAO_SAIDA = 'https://kommodo.ai/i/N7VRBMdb6o6EDeM9FY4t';

// Emojis customizados dos botões do painel de fila (Gel / Sair).
// O bot sobe as duas imagens abaixo como emojis do servidor sozinho, na
// primeira vez que liga (precisa da permissão "Gerenciar
// Emojis e Figurinhas"). Se você preferir subir manualmente, defina
// EMOJI_GEL / EMOJI_SAIR (formato <:nome:ID>) nas variáveis de ambiente
// que o bot usa elas direto e nem tenta criar as automáticas.
const EMOJI_GEL_IMAGEM_URL = process.env.EMOJI_GEL_IMAGEM_URL || IMG_GELO;
const EMOJI_SAIR_IMAGEM_URL = process.env.EMOJI_SAIR_IMAGEM_URL || IMG_BOTAO_SAIDA;
const EMOJI_FINALIZAR_IMAGEM_URL =
  process.env.EMOJI_FINALIZAR_IMAGEM_URL ||
  'https://drive.google.com/uc?export=view&id=1R_LHVMgxE5P9mNuGpC35tSaRWOofDS70';
const EMOJI_COROA_IMAGEM_URL = process.env.EMOJI_COROA_IMAGEM_URL || IMG_COROA_URL;
const EMOJI_TROFEU_IMAGEM_URL = process.env.EMOJI_TROFEU_IMAGEM_URL || IMG_TROFEU;
const EMOJI_RANKING_IMAGEM_URL = process.env.EMOJI_RANKING_IMAGEM_URL || IMG_BOTAO_RANKING;

let EMOJI_GEL = process.env.EMOJI_GEL || '🧪';
let EMOJI_SAIR = process.env.EMOJI_SAIR || '↪️';
let EMOJI_FINALIZAR = process.env.EMOJI_FINALIZAR || '🏁';
let EMOJI_COROA = process.env.EMOJI_COROA || '👑';
let EMOJI_TROFEU = process.env.EMOJI_TROFEU || '🏆';
let EMOJI_RANKING = process.env.EMOJI_RANKING || '📊';
// Emoji dos botões de fila "N Emu" (variante misto do 2x2/3x3/4x4).
let EMOJI_PC = process.env.EMOJI_PC || '🖥️';
// Emoji da coroa usada no botão "Ranking" dos painéis (diferente da
// coroa que marca o 1º lugar dentro do ranking, essa é EMOJI_COROA).
let EMOJI_COROA_2 = process.env.EMOJI_COROA_2 || '👑';
// Logo da organização (:org_colmeia:), usada como thumbnail (canto
// superior direito) dos painéis de fila e dos painéis de ranking.
let EMOJI_ORG = process.env.EMOJI_ORG || '';
let EMOJI_ORG_URL = process.env.EMOJI_ORG_URL || IMG_TROFEU;
// Emoji do botão QR na ficha da partida.
let EMOJI_QR = process.env.EMOJI_QR || '🔳';
// Emoji/imagem "colmeia_1", usado como thumbnail no lugar da imagem
// quebrada em Meu Perfil e em todos os rankings.
let EMOJI_COLMEIA1 = process.env.EMOJI_COLMEIA1 || '';
let EMOJI_COLMEIA1_URL = process.env.EMOJI_COLMEIA1_URL || IMG_TROFEU;
// Emoji "abelhas" -> usado como thumbnail no card "ID e Senha".
let EMOJI_ABELHAS_URL = process.env.EMOJI_ABELHAS_URL || IMG_TROFEU;
// Emojis usados em Meu Perfil / Ranking-ADM.
let EMOJI_DINDIN = process.env.EMOJI_DINDIN || '💰';
let EMOJI_PROGRESSO = process.env.EMOJI_PROGRESSO || '⏱️';
let EMOJI_MNRAMIO = process.env.EMOJI_MNRAMIO || '📈';
let EMOJI_GIRO = process.env.EMOJI_GIRO || '🔄';
let EMOJI_GIRO_OURO = process.env.EMOJI_GIRO_OURO || '🔄';
// Emoji do botão "Entrar" nos painéis de fila única (2x2/3x3/4x4 sem misto).
let EMOJI_ENTRA = process.env.EMOJI_ENTRA || '➡️';
let EMOJI_COPIAR = process.env.EMOJI_COPIAR || '📋';
let EMOJI_INFO = process.env.EMOJI_INFO || 'ℹ️';

// ---- Config de cargos (persistido em arquivo, editável por comando) ----
// CEO/Mediador/Analista/Suporte podem ser configurados pelo .env OU por
// comando direto no Discord (!setcargoceo, !setcargomediador, etc) —
// o que for configurado por comando tem prioridade e fica salvo em
// arquivo, sem precisar reiniciar o bot nunca mais.
const CAMINHO_CONFIG_CARGOS = path.join(__dirname, 'config-cargos.json');
let CONFIG_CARGOS = {};
try {
  CONFIG_CARGOS = JSON.parse(fs.readFileSync(CAMINHO_CONFIG_CARGOS, 'utf-8'));
} catch (err) {
  CONFIG_CARGOS = {};
}

// Cargo "CEO": tem as mesmas permissões do cargo Mediador em tudo,
// mais acesso total aos comandos do bot (configure o ID do cargo).
let CEO_ROLE_ID = CONFIG_CARGOS.ceoRoleId || process.env.CEO_ROLE_ID || null;

// Dono fixo do bot: esse ID de USUÁRIO (não de cargo) sempre passa em
// qualquer checagem de CEO/Mediador, não importa se o cargo dele no
// servidor está configurado certo ou não. É um "acesso de emergência"
// pra nunca ficar travado por causa de configuração de cargo errada.
// Coloque seu ID de usuário do Discord aqui (ou na variável de
// ambiente DONO_USER_ID) — clique direito no seu perfil, com o Modo
// Desenvolvedor ativado, e "Copiar ID do Usuário".
const DONO_USER_ID = process.env.DONO_USER_ID || null;

// Canal fixo onde os tópicos de partida (fila) são sempre criados,
// não importa em qual canal o botão do painel foi clicado.
// https://discord.com/channels/1541228432879259760/1541242653532750005
const CANAL_FILAS_ID = process.env.CANAL_FILAS_ID || '1541242653532750005';

// Cria (uma vez) os emojis personalizados "colmeia_gel" e "colmeia_sair"
// em cada servidor onde o bot está, a partir das imagens configuradas
// acima, e passa a usá-los nos botões do painel. Se EMOJI_GEL/EMOJI_SAIR
// já foram definidos manualmente por variável de ambiente, não mexe em
// nada.
// Procura, na ordem, um emoji do servidor com um desses nomes (os que
// você já criou manualmente entram primeiro). Se não achar nenhum,
// cria um novo a partir da imagem de referência.
async function buscarOuCriarEmoji(guild, nomesPossiveis, urlImagem, nomeParaCriar) {
  // Sem isso, a cache de emojis pode estar incompleta (principalmente
  // logo depois do bot ligar) e o bot não acha emojis que já existem
  // no servidor, tentando criar duplicado toda vez.
  await guild.emojis.fetch().catch(() => {});

  for (const nome of nomesPossiveis) {
    const encontrado = guild.emojis.cache.find((e) => e.name === nome);
    if (encontrado) return encontrado;
  }
  return guild.emojis.create({ attachment: urlImagem, name: nomeParaCriar });
}

async function garantirEmojisPersonalizados() {
  if (
    process.env.EMOJI_GEL &&
    process.env.EMOJI_SAIR &&
    process.env.EMOJI_FINALIZAR &&
    process.env.EMOJI_COROA &&
    process.env.EMOJI_TROFEU &&
    process.env.EMOJI_RANKING &&
    process.env.EMOJI_PC &&
    process.env.EMOJI_COROA_2 &&
    process.env.EMOJI_ORG
  )
    return;

  for (const guild of client.guilds.cache.values()) {
    const tentar = async (label, fn) => {
      try {
        await fn();
      } catch (err) {
        console.error(
          `⚠️ Não consegui preparar o emoji "${label}" no servidor "${guild.name}" (verifique a permissão "Gerenciar Emojis e Figurinhas", se o nome do emoji existe no servidor, e se a imagem de fallback está acessível publicamente):`,
          err.message
        );
      }
    };

    await tentar('gelo', async () => {
      if (process.env.EMOJI_GEL) return;
      const emoji = await buscarOuCriarEmoji(guild, ['gelo', 'colmeia_gel'], EMOJI_GEL_IMAGEM_URL, 'gelo');
      EMOJI_GEL = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('saida', async () => {
      if (process.env.EMOJI_SAIR) return;
      const emoji = await buscarOuCriarEmoji(guild, ['saida', 'colmeia_sair'], EMOJI_SAIR_IMAGEM_URL, 'saida');
      EMOJI_SAIR = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('finalizar', async () => {
      if (process.env.EMOJI_FINALIZAR) return;
      const emoji = await buscarOuCriarEmoji(guild, ['finalizar', 'colmeia_finalizar'], EMOJI_FINALIZAR_IMAGEM_URL, 'finalizar');
      EMOJI_FINALIZAR = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('coroa_1', async () => {
      if (process.env.EMOJI_COROA) return;
      const emoji = await buscarOuCriarEmoji(guild, ['coroa_1', 'coroa', 'colmeia_coroa'], EMOJI_COROA_IMAGEM_URL, 'coroa_1');
      EMOJI_COROA = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('trofeus', async () => {
      if (process.env.EMOJI_TROFEU) return;
      const emoji = await buscarOuCriarEmoji(guild, ['trofeus', 'trofeu', 'colmeia_trofeu'], EMOJI_TROFEU_IMAGEM_URL, 'trofeus');
      EMOJI_TROFEU = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('ranking', async () => {
      if (process.env.EMOJI_RANKING) return;
      const emoji = await buscarOuCriarEmoji(guild, ['ranking', 'console', 'colmeia_ranking'], EMOJI_RANKING_IMAGEM_URL, 'ranking');
      EMOJI_RANKING = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('pc', async () => {
      if (process.env.EMOJI_PC) return;
      const emoji = await buscarOuCriarEmoji(guild, ['pc', 'colmeia_pc'], EMOJI_TROFEU_IMAGEM_URL, 'pc');
      EMOJI_PC = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('coroa_2', async () => {
      if (process.env.EMOJI_COROA_2) return;
      const emoji = await buscarOuCriarEmoji(guild, ['coroa_2', 'colmeia_coroa_2'], EMOJI_COROA_IMAGEM_URL, 'coroa_2');
      EMOJI_COROA_2 = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('org_colmeia', async () => {
      if (process.env.EMOJI_ORG) return;
      const emoji = await buscarOuCriarEmoji(guild, ['org_colmeia', 'colmeia_org'], EMOJI_TROFEU_IMAGEM_URL, 'org_colmeia');
      EMOJI_ORG = `<:${emoji.name}:${emoji.id}>`;
      EMOJI_ORG_URL = emoji.imageURL({ extension: 'png', size: 128 });
    });

    await tentar('qr', async () => {
      if (process.env.EMOJI_QR) return;
      const emoji = await buscarOuCriarEmoji(guild, ['qr', 'colmeia_qr'], EMOJI_TROFEU_IMAGEM_URL, 'qr');
      EMOJI_QR = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('colmeia_1', async () => {
      if (process.env.EMOJI_COLMEIA1) return;
      const emoji = await buscarOuCriarEmoji(guild, ['colmeia_1', 'colmeia1'], EMOJI_TROFEU_IMAGEM_URL, 'colmeia_1');
      EMOJI_COLMEIA1 = `<:${emoji.name}:${emoji.id}>`;
      EMOJI_COLMEIA1_URL = emoji.imageURL({ extension: 'png', size: 128 });
    });

    await tentar('abelhas', async () => {
      if (process.env.EMOJI_ABELHAS_URL) return;
      // Procura o emoji "abelhas" que já existe no servidor (não cria
      // um novo se já tiver um com esse nome).
      const emoji = await buscarOuCriarEmoji(guild, ['abelhas', 'abelha', 'colmeia_abelhas'], EMOJI_TROFEU_IMAGEM_URL, 'abelhas');
      EMOJI_ABELHAS_URL = emoji.imageURL({ extension: 'png', size: 256 });
    });

    await tentar('dindin', async () => {
      if (process.env.EMOJI_DINDIN) return;
      const emoji = await buscarOuCriarEmoji(guild, ['dindin', 'colmeia_dindin'], EMOJI_TROFEU_IMAGEM_URL, 'dindin');
      EMOJI_DINDIN = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('progresso', async () => {
      if (process.env.EMOJI_PROGRESSO) return;
      const emoji = await buscarOuCriarEmoji(guild, ['progresso', 'colmeia_progresso'], EMOJI_TROFEU_IMAGEM_URL, 'progresso');
      EMOJI_PROGRESSO = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('mnramio', async () => {
      if (process.env.EMOJI_MNRAMIO) return;
      const emoji = await buscarOuCriarEmoji(guild, ['mnramio', 'colmeia_mnramio'], EMOJI_TROFEU_IMAGEM_URL, 'mnramio');
      EMOJI_MNRAMIO = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('giro', async () => {
      if (process.env.EMOJI_GIRO) return;
      const emoji = await buscarOuCriarEmoji(guild, ['giro', 'colmeia_giro'], EMOJI_TROFEU_IMAGEM_URL, 'giro');
      EMOJI_GIRO = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('giro_ouro', async () => {
      if (process.env.EMOJI_GIRO_OURO) return;
      const emoji = await buscarOuCriarEmoji(guild, ['giro_ouro', 'colmeia_giro_ouro'], EMOJI_TROFEU_IMAGEM_URL, 'giro_ouro');
      EMOJI_GIRO_OURO = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('ggppss', async () => {
      if (process.env.EMOJI_ENTRA) return;
      const emoji = await buscarOuCriarEmoji(guild, ['ggppss', 'colmeia_ggppss'], EMOJI_TROFEU_IMAGEM_URL, 'ggppss');
      EMOJI_ENTRA = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('copiar', async () => {
      if (process.env.EMOJI_COPIAR) return;
      const emoji = await buscarOuCriarEmoji(guild, ['copiar', 'colmeia_copiar'], EMOJI_TROFEU_IMAGEM_URL, 'copiar');
      EMOJI_COPIAR = `<:${emoji.name}:${emoji.id}>`;
    });

    await tentar('informacoes', async () => {
      if (process.env.EMOJI_INFO) return;
      const emoji = await buscarOuCriarEmoji(guild, ['informaes', 'informações', 'informacoes', 'colmeia_info'], EMOJI_TROFEU_IMAGEM_URL, 'informacoes');
      EMOJI_INFO = `<:${emoji.name}:${emoji.id}>`;
    });
  }
}

// Salva um cargo configurado (chave: 'ceoRoleId', 'mediadorRoleId',
// 'analistaRoleId' ou 'suporteRoleId') no arquivo, pra sobreviver a
// reinícios do bot sem precisar mexer no .env.
function salvarConfigCargo(chave, valor) {
  CONFIG_CARGOS[chave] = valor;
  fs.writeFileSync(CAMINHO_CONFIG_CARGOS, JSON.stringify(CONFIG_CARGOS, null, 2), 'utf-8');
}

// Tira o ID de um cargo mencionado na mensagem (@Cargo) ou, se não tiver
// menção, o primeiro número longo que aparecer no texto (ID colado à mão).
function extrairIdDeCargo(message) {
  const cargoMencionado = message.mentions.roles.first();
  if (cargoMencionado) return cargoMencionado.id;
  const match = message.content.match(/\d{15,25}/);
  return match ? match[0] : null;
}
const TUTORIAL_URL = process.env.TUTORIAL_URL || 'https://discord.com';
// Faltava essa declaração — sem ela, todo botão "Regras" (ficha da
// partida, cadastro de Pix) quebrava com "REGRAS_URL is not defined".
const REGRAS_URL = process.env.REGRAS_URL || 'https://discord.com/channels/1541228432879259760/1541259460884963361';
const COR_DOURADA = 0xD4AF37;
let MEDIADOR_ROLE_ID = CONFIG_CARGOS.mediadorRoleId || process.env.MEDIADOR_ROLE_ID || null;
// Cargo dado automaticamente pra quem entra no servidor.
const MEMBRO_ROLE_ID = process.env.MEMBRO_ROLE_ID || null;
let SUPORTE_ROLE_ID = CONFIG_CARGOS.suporteRoleId || process.env.SUPORTE_ROLE_ID || null;
// Canal onde o bot avisa quando um ticket de suporte cai em "Outros"
// (fica um suporte precisando entrar na fila pra atender).
// https://discord.com/channels/1541228432879259760/1541248202228113479
const CANAL_AVISO_SUPORTE_ID = process.env.CANAL_AVISO_SUPORTE_ID || '1541248202228113479';

// Chave Pix padrão, usada se o mediador sorteado ainda não se cadastrou.
const PIX_PADRAO = process.env.CHAVE_PIX_PADRAO || 'colmeia.org@gmail.com';

// Confere se a chave Pix (e o nome, se informado) fazem sentido antes
// de salvar o cadastro. Retorna null se estiver tudo certo, ou uma
// mensagem de erro explicando o que deu errado.
function validarCadastroMediador(chave, nome) {
  const chaveLimpa = (chave || '').trim();
  if (!chaveLimpa) {
    return 'Você precisa informar uma chave Pix.';
  }

  // Se tem "@" no meio, a pessoa quis usar e-mail como chave — nesse
  // caso exigimos um Gmail completo (nome@gmail.com). Qualquer outro
  // tipo de chave (número/telefone, com ou sem espaço, CPF/CNPJ, ou
  // chave aleatória) passa direto, sem travar em nada — igual antes.
  if (chaveLimpa.includes('@')) {
    const emailValido = /^[^\s@]+@gmail\.com$/i.test(chaveLimpa);
    if (!emailValido) {
      return 'Esse e-mail não é válido. Só aceitamos e-mails completos terminando em **@gmail.com** (ex: nome@gmail.com).';
    }
  }

  // Nome: aceita qualquer coisa que a pessoa digitar, sem validação.
  return null;
}

// ---- Cadastro de mediadores (persistido em arquivo) ----
// Cada mediador cadastra a própria chave sozinho, pelo painel de botões
// "Cadastrar Pix" (abre um formulário). Formato salvo por mediador:
//   { chave: '...', nome: '...' | null, qrcodeUrl: '...' | null }
const CAMINHO_DADOS_MEDIADORES = path.join(__dirname, 'mediadores.json');

function carregarMediadorPix() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_DADOS_MEDIADORES, 'utf-8');
    return JSON.parse(conteudo);
  } catch (err) {
    return {}; // arquivo ainda não existe ou está vazio
  }
}

function salvarMediadorPix(mapa) {
  fs.writeFileSync(CAMINHO_DADOS_MEDIADORES, JSON.stringify(mapa, null, 2), 'utf-8');
}

let MEDIADOR_PIX = carregarMediadorPix();

// ---- Lista de "mediadores extras" (persistido em arquivo) ----
// Além de quem tem o cargo MEDIADOR_ROLE_ID, dá pra dar acesso de
// Mediador (Cancelar, Finalizar Aposta, Escolher Vencedor, etc.) pra
// pessoas específicas direto pelo Discord, com !addmediadoracesso e
// !removermediadoracesso — sem precisar mexer em cargo nem no .env.
// Formato salvo: array de IDs de usuário. (Só existe UM dono/CEO fixo,
// configurado em DONO_USER_ID no .env — isso aqui é só pra mediador.)
const CAMINHO_MEDIADORES_EXTRAS = path.join(__dirname, 'mediadores-extras.json');

function carregarMediadoresExtras() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_MEDIADORES_EXTRAS, 'utf-8');
    return JSON.parse(conteudo);
  } catch (err) {
    return []; // arquivo ainda não existe ou está vazio
  }
}

function salvarMediadoresExtras(lista) {
  fs.writeFileSync(CAMINHO_MEDIADORES_EXTRAS, JSON.stringify(lista, null, 2), 'utf-8');
}

let MEDIADORES_EXTRAS = carregarMediadoresExtras();

// ---------- BLACKLIST (IDs de Free Fire banidos) ----------
const CAMINHO_BLACKLIST = path.join(__dirname, 'blacklist.json');

function carregarBlacklist() {
  try {
    return JSON.parse(fs.readFileSync(CAMINHO_BLACKLIST, 'utf-8'));
  } catch (err) {
    return {}; // { "123456789": { motivo: "...", ts: 123 } }
  }
}
function salvarBlacklist(mapa) {
  fs.writeFileSync(CAMINHO_BLACKLIST, JSON.stringify(mapa, null, 2), 'utf-8');
}
let BLACKLIST = carregarBlacklist();

// Pessoa que é marcada quando alguém abre um tópico de "Receber
// Pagamento" (você, no caso). Se não configurar, marca o cargo CEO.
const CEO_USER_ID = process.env.CEO_USER_ID || null;

// ---- Ranking de vitórias (persistido em arquivo) ----
// { userId: quantidadeDeVitorias }
const CAMINHO_DADOS_RANKING = path.join(__dirname, 'ranking.json');

function carregarRanking() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_DADOS_RANKING, 'utf-8');
    return JSON.parse(conteudo);
  } catch (err) {
    return {};
  }
}

function salvarRanking(mapa) {
  fs.writeFileSync(CAMINHO_DADOS_RANKING, JSON.stringify(mapa, null, 2), 'utf-8');
}

let RANKING_VITORIAS = carregarRanking();

function registrarVitoria(userId) {
  RANKING_VITORIAS[userId] = (RANKING_VITORIAS[userId] || 0) + 1;
  salvarRanking(RANKING_VITORIAS);
}

// ---- Ranking-adm: horas na fila de mediador + ganhos (R$0,50/fila) ----
// { userId: { segundos: N, entradaTs: N|undefined, ganhos: [{ts, valor}] } }
const CAMINHO_DADOS_ADM = path.join(__dirname, 'ranking-adm.json');

function carregarRankingAdm() {
  try {
    return JSON.parse(fs.readFileSync(CAMINHO_DADOS_ADM, 'utf-8'));
  } catch (err) {
    return {};
  }
}
function salvarRankingAdm(mapa) {
  fs.writeFileSync(CAMINHO_DADOS_ADM, JSON.stringify(mapa, null, 2), 'utf-8');
}
let DADOS_ADM = carregarRankingAdm();

function pegarDadosAdm(userId) {
  if (!DADOS_ADM[userId]) DADOS_ADM[userId] = { segundos: 0, ganhos: [] };
  return DADOS_ADM[userId];
}
function iniciarSessaoAdm(userId) {
  const dados = pegarDadosAdm(userId);
  dados.entradaTs = Date.now();
  salvarRankingAdm(DADOS_ADM);
}
function encerrarSessaoAdm(userId) {
  const dados = pegarDadosAdm(userId);
  if (dados.entradaTs) {
    dados.segundos += Math.floor((Date.now() - dados.entradaTs) / 1000);
    delete dados.entradaTs;
    salvarRankingAdm(DADOS_ADM);
  }
}
function registrarGanhoAdm(userId, valor) {
  const dados = pegarDadosAdm(userId);
  dados.ganhos.push({ ts: Date.now(), valor });
  salvarRankingAdm(DADOS_ADM);
}

// ---------- RANKING/DADOS DE SUPORTE (mesmo padrão do analista) ----------
const CAMINHO_DADOS_SUPORTE = path.join(__dirname, 'ranking-suporte.json');

function carregarRankingSuporte() {
  try {
    return JSON.parse(fs.readFileSync(CAMINHO_DADOS_SUPORTE, 'utf-8'));
  } catch (err) {
    return {};
  }
}
function salvarRankingSuporte(mapa) {
  fs.writeFileSync(CAMINHO_DADOS_SUPORTE, JSON.stringify(mapa, null, 2), 'utf-8');
}
let DADOS_SUPORTE = carregarRankingSuporte();

function pegarDadosSuporte(userId) {
  if (!DADOS_SUPORTE[userId]) DADOS_SUPORTE[userId] = { segundos: 0, atendimentos: 0, ganhos: [] };
  return DADOS_SUPORTE[userId];
}
function iniciarSessaoSuporte(userId) {
  const dados = pegarDadosSuporte(userId);
  dados.entradaTs = Date.now();
  salvarRankingSuporte(DADOS_SUPORTE);
}
function encerrarSessaoSuporte(userId) {
  const dados = pegarDadosSuporte(userId);
  if (dados.entradaTs) {
    dados.segundos += Math.floor((Date.now() - dados.entradaTs) / 1000);
    delete dados.entradaTs;
    salvarRankingSuporte(DADOS_SUPORTE);
  }
}
function registrarAtendimentoSuporte(userId) {
  const dados = pegarDadosSuporte(userId);
  dados.atendimentos += 1;
  salvarRankingSuporte(DADOS_SUPORTE);
}

// ---------- CADASTRO PIX DO SUPORTE (mesmo padrão do analista) ----------
const CAMINHO_SUPORTE_PIX = path.join(__dirname, 'suporte-pix.json');

function carregarSuportePix() {
  try {
    return JSON.parse(fs.readFileSync(CAMINHO_SUPORTE_PIX, 'utf-8'));
  } catch (err) {
    return {};
  }
}
function salvarSuportePix(mapa) {
  fs.writeFileSync(CAMINHO_SUPORTE_PIX, JSON.stringify(mapa, null, 2), 'utf-8');
}
let SUPORTE_PIX = carregarSuportePix();

async function usuarioPodeSuportar(interaction) {
  if (await usuarioECeo(interaction)) return true;
  if (!SUPORTE_ROLE_ID) {
    console.error('⚠️ SUPORTE_ROLE_ID não configurado no .env — ninguém sem cargo CEO consegue usar essas opções até isso ser configurado.');
    return false;
  }
  return membroTemCargo(interaction.member, SUPORTE_ROLE_ID, interaction.guild);
}

// Soma os ganhos de uma lista [{ts, valor}] a partir de uma data (ms).
function somarGanhosDesde(lista, desdeTs) {
  return lista.filter((g) => g.ts >= desdeTs).reduce((soma, g) => soma + g.valor, 0);
}
function formatarHoras(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}min`;
}
function segundosAcumulados(dados) {
  const emAndamento = dados.entradaTs ? Math.floor((Date.now() - dados.entradaTs) / 1000) : 0;
  return dados.segundos + emAndamento;
}

// Links do aviso "mudou a forma de mostrar a tela"
const LINK_ANDROID = 'https://play.google.com/store/apps/details?id=com.google.android.apps.tachyon';
const LINK_IOS = 'https://apps.apple.com/br/app/google-meet/id1096918571';
const LINK_WINDOWS = 'https://meet.google.com/home?authuser=0';
// ------------------------------------------------

// Controla quais números de tópico já foram usados, pra não repetir.
const numerosUsados = new Set();
// Guarda o próximo número da sequência, enquanto houver pelo menos uma
// fila ativa. Quando todas as filas terminam (partidas.size === 0), a
// sequência reinicia com um número aleatório novo.
let proximoNumeroSequencial = null;

function gerarNumeroFilaAleatorio() {
  // Sem nenhuma fila ativa agora -> começa uma sequência nova a partir
  // de um número aleatório.
  if (partidas.size === 0 || proximoNumeroSequencial === null) {
    let numero;
    do {
      numero = Math.floor(Math.random() * 999999) + 1;
    } while (numerosUsados.has(numero));
    numerosUsados.add(numero);
    proximoNumeroSequencial = numero + 1;
    return numero;
  }

  // Já tem fila(s) ativa(s) -> continua a sequência em ordem (fica bem
  // mais fácil de acompanhar quando pega muitas filas seguidas).
  let numero = proximoNumeroSequencial;
  while (numerosUsados.has(numero)) numero++;
  numerosUsados.add(numero);
  proximoNumeroSequencial = numero + 1;
  return numero;
}

// Estado das partidas em confirmação/ficha, indexado pelo ID do tópico.
// { jogadores: [userId,...], confirmados: Set, nomeFila, rotuloFormato,
//   valor, mediadorId, vencedorId, cancelando: bool }
//
// Fica salvo em arquivo (partidas.json) pra sobreviver a reinícios do
// bot — sem isso, se o bot reiniciasse com uma partida em andamento
// (aguardando confirmação, sala, ou vencedor), essa partida "sumia" e
// as opções paravam de funcionar no meio do processo.
const CAMINHO_PARTIDAS = path.join(__dirname, 'partidas.json');

function carregarPartidas() {
  try {
    const conteudo = fs.readFileSync(CAMINHO_PARTIDAS, 'utf-8');
    const entradas = JSON.parse(conteudo);
    return new Map(
      entradas.map(([threadId, partida]) => [threadId, { ...partida, confirmados: new Set(partida.confirmados || []) }])
    );
  } catch (err) {
    return new Map();
  }
}

function salvarPartidas() {
  const entradas = Array.from(partidas.entries()).map(([threadId, partida]) => {
    // "salaMessage" e "mensagensConfirmacao" são referências vivas de
    // mensagem do Discord.js — não dá (nem precisa) salvar isso em
    // arquivo, só os dados puros.
    const { salaMessage, mensagensConfirmacao, ...dadosSalvaveis } = partida;
    return [threadId, { ...dadosSalvaveis, confirmados: Array.from(partida.confirmados) }];
  });
  fs.writeFileSync(CAMINHO_PARTIDAS, JSON.stringify(entradas, null, 2), 'utf-8');
}

const partidas = carregarPartidas();

// Repovoa os números de fila já em uso (importante depois de reiniciar
// o bot com partidas ainda ativas — sem isso, um número já usado por
// uma partida em andamento podia ser sorteado de novo pra uma nova).
for (const partida of partidas.values()) {
  if (partida.numeroFila) numerosUsados.add(partida.numeroFila);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // necessário pra sortear o mediador pelo cargo
    GatewayIntentBits.GuildPresences, // necessário pra detectar quando o mediador fecha o Discord (fica offline)
  ],
});

// ---------- PAINEL PRINCIPAL (fila de entrada) ----------

function montarEmbedPainel(instancia) {
  const embed = new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle(`${instancia.rotuloFormato} | ${instancia.valor}`)
    .setThumbnail(EMOJI_ORG_URL);

  for (const f of instancia.filasDef) {
    embed.addFields({
      name: `${f.label}:`,
      value: instancia.filas[f.key].length
        ? instancia.filas[f.key].map((id) => `<@${id}>`).join('\n')
        : 'Nenhum jogador na fila.',
    });
  }

  return embed;
}

function montarBotoesPainel(instancia) {
  const botoes = instancia.filasDef.map((f) => {
    if (f.tipo === 'unica') {
      return new ButtonBuilder()
        .setCustomId(`fila_${f.key}:${instancia.id}`)
        .setLabel('Entrar')
        .setEmoji(EMOJI_ENTRA)
        .setStyle(ButtonStyle.Success);
    }
    return new ButtonBuilder()
      .setCustomId(`fila_${f.key}:${instancia.id}`)
      .setLabel(f.label)
      .setEmoji(f.tipo === 'emu' ? EMOJI_PC : EMOJI_GEL)
      .setStyle(ButtonStyle.Secondary);
  });

  botoes.push(
    new ButtonBuilder().setCustomId(`fila_sair:${instancia.id}`).setLabel('Sair').setEmoji(EMOJI_SAIR).setStyle(ButtonStyle.Danger)
  );

  return new ActionRowBuilder().addComponents(...botoes);
}

async function atualizarPainel(interaction, instancia) {
  const mensagem = interaction.message;
  const linhasAtuais = mensagem.components;

  // Acha em qual posição (embed + linha de botões) esse painel está
  // dentro da mensagem — necessário porque, quando o admin posta vários
  // valores de uma vez, todos os painéis ficam juntos na MESMA mensagem
  // (pra evitar o Discord esconder o nome/foto do bot em mensagens seguidas).
  const indice = linhasAtuais.findIndex((linha) =>
    linha.components.some((botao) => botao.customId && botao.customId.endsWith(`:${instancia.id}`))
  );

  if (indice === -1) {
    return interaction.update({
      embeds: [montarEmbedPainel(instancia)],
      components: [montarBotoesPainel(instancia)],
    });
  }

  const novosEmbeds = mensagem.embeds.map((e) => EmbedBuilder.from(e));
  const novosComponents = linhasAtuais.map((linha) => ActionRowBuilder.from(linha));

  novosEmbeds[indice] = montarEmbedPainel(instancia);
  novosComponents[indice] = montarBotoesPainel(instancia);

  await interaction.update({ embeds: novosEmbeds, components: novosComponents });
}

// ---------- EMBED DE CONFIRMAÇÃO (dentro do tópico) ----------

function montarEmbedConfirmacao(partida) {
  const confirmados = [...partida.confirmados].map((id) => `<@${id}>`);
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle(`${partida.rotuloFormato} - ${partida.nomeFila} | ${partida.valor}`)
    .addFields({
      name: 'Confirmados:',
      value: confirmados.length ? confirmados.join('\n') : 'Ninguém confirmou ainda.',
    });
}

function montarBotoesConfirmacao() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('partida_confirmar').setLabel('Confirmar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('partida_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
  );
}

// ---------- FICHA DA PARTIDA (após confirmação, com mediador) ----------

function montarEmbedFicha(partida) {
  const metade = partida.jogadores.length / 2;
  const timeA = partida.jogadores.slice(0, metade).map((id) => `<@${id}>`).join(' e ');
  const timeB = partida.jogadores.slice(metade).map((id) => `<@${id}>`).join(' e ');

  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle(`${partida.rotuloFormato} - ${partida.nomeFila} | ${partida.valor}`)
    .addFields(
      { name: 'Jogadores:', value: `${timeA} vs ${timeB}` },
      { name: 'Mediador:', value: partida.mediadorId ? `<@${partida.mediadorId}>` : 'Nenhum mediador disponível no momento.' },
      { name: 'Formato:', value: partida.rotuloFormato },
      { name: 'Taxa de Inscrição:', value: partida.valor }
    );
}

function montarBotoesFicha() {
  const botoes = [];

  // botão de link é o único que pode travar por causa de URL inválida
  // — isolado num try/catch pra nunca derrubar QR/Cancelar por causa dele
  try {
    botoes.push(new ButtonBuilder().setLabel('Regras').setEmoji('📚').setStyle(ButtonStyle.Link).setURL(REGRAS_URL));
  } catch (err) {
    console.error('⚠️ Não consegui montar o botão de Regras (URL inválida?):', err.message);
  }

  botoes.push(
    new ButtonBuilder().setCustomId('ficha_qr').setLabel('QR').setEmoji(EMOJI_QR).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ficha_cancelar').setLabel('Cancelar').setEmoji(EMOJI_SAIR).setStyle(ButtonStyle.Danger)
  );

  return new ActionRowBuilder().addComponents(...botoes);
}

// ---------- FINALIZAR APOSTA / DEFINIR VENCEDOR (só mediador) ----------

// Checagem de cargo à prova de falhas: o Discord às vezes entrega um
// "member" parcial (ex.: cache vazio, ou vindo de uma interação sem o
// member completo carregado). Nesses casos, member.roles.cache pode
// não existir ou não ter todos os cargos. Esse helper tenta de várias
// formas antes de desistir, e busca o member completo do servidor como
// último recurso.
async function membroTemCargo(member, roleId, guild) {
  if (!roleId) return false;
  if (!member) return false;

  // Forma normal: GuildMember com roles.cache (Collection)
  if (member.roles && typeof member.roles.cache?.has === 'function') {
    if (member.roles.cache.has(roleId)) return true;
  }

  // Forma alternativa: member parcial, roles como array de IDs
  if (Array.isArray(member.roles) && member.roles.includes(roleId)) return true;
  if (Array.isArray(member._roles) && member._roles.includes(roleId)) return true;

  // Último recurso: busca o member direto do servidor (ignora cache
  // velho/incompleto) — só faz isso se tiver o guild disponível.
  const guildParaBuscar = guild || member.guild;
  if (guildParaBuscar) {
    try {
      const membroCompleto = await guildParaBuscar.members.fetch(member.id || member.user?.id);
      return membroCompleto.roles.cache.has(roleId);
    } catch (err) {
      return false;
    }
  }

  return false;
}

// ID do usuário, tirado do "member" independente do formato que ele
// vier (GuildMember normal, member parcial, etc).
function pegarIdDoMembro(member) {
  if (!member) return null;
  return member.id || member.user?.id || null;
}

async function membroECeo(member, guild) {
  const id = pegarIdDoMembro(member);
  if (DONO_USER_ID && id === DONO_USER_ID) return true;
  return CEO_ROLE_ID ? membroTemCargo(member, CEO_ROLE_ID, guild) : false;
}

async function membroPodeMediar(member, guild) {
  if (await membroECeo(member, guild)) return true;

  const id = pegarIdDoMembro(member);
  if (id && MEDIADORES_EXTRAS.includes(id)) return true;

  if (!MEDIADOR_ROLE_ID) {
    console.error('⚠️ MEDIADOR_ROLE_ID não configurado no .env — ninguém sem cargo CEO consegue mediar até isso ser configurado.');
    return false;
  }
  return membroTemCargo(member, MEDIADOR_ROLE_ID, guild);
}

async function usuarioECeo(interaction) {
  return membroECeo(interaction.member, interaction.guild);
}

// Mesma checagem, só que pra comandos de texto (!comando), onde a
// gente recebe uma "message" do Discord.js em vez de uma "interaction".
async function usuarioECeoMensagem(message) {
  return membroECeo(message.member, message.guild);
}

async function usuarioPodeMediar(interaction) {
  return membroPodeMediar(interaction.member, interaction.guild);
}

// Quantas vezes cada pessoa já tentou usar Finalizar Aposta/Escolher
// Vencedor/W.O./Cancelar sem ter o cargo de mediador. Vale pra
// QUALQUER partida/fila (não reseta por partida) — só reseta se o bot
// reiniciar.
const tentativasNegadasMediador = new Map();

// 1ª tentativa sem cargo: mostra o aviso normal. 2ª tentativa: mostra
// um aviso diferente. Da 3ª em diante: não mostra mais nenhuma
// mensagem (só recusa a ação por baixo dos panos).
async function negarAcessoMediador(interaction) {
  const tentativaAtual = (tentativasNegadasMediador.get(interaction.user.id) || 0) + 1;
  tentativasNegadasMediador.set(interaction.user.id, tentativaAtual);

  if (tentativaAtual === 1) {
    return interaction.reply({ content: 'Só quem tem o cargo de mediador pode usar essa opção.', ephemeral: true });
  }
  if (tentativaAtual === 2) {
    return interaction.reply({ content: 'Essa opção continua só pra quem tem o cargo de mediador.', ephemeral: true });
  }
  // 3ª tentativa em diante: reconhece o clique sem mostrar nada.
  return interaction.deferUpdate().catch(() => {});
}

function montarSelectFinalizarAposta() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ficha_menu_opcoes')
    .setPlaceholder('Selecione uma opção')
    .addOptions({
      label: 'Finalizar Aposta',
      description: 'Encerra a aposta.',
      value: 'finalizar_aposta',
      emoji: EMOJI_FINALIZAR,
    });
  return new ActionRowBuilder().addComponents(select);
}

async function pegarNomeExibicao(guild, userId) {
  try {
    const membro = await guild.members.fetch(userId);
    return membro.displayName;
  } catch (err) {
    return `Usuário ${userId}`;
  }
}

async function montarSelectEscolherVencedor(guild, partida) {
  const opcoes = await Promise.all(
    partida.jogadores.map(async (id) => {
      const nome = await pegarNomeExibicao(guild, id);
      return { label: nome, description: id, value: id };
    })
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('ficha_escolher_vencedor')
    .setPlaceholder('Escolha o vencedor')
    .addOptions(...opcoes);
  return new ActionRowBuilder().addComponents(select);
}

function montarEmbedEscolherVencedor() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('Definir Vencedor')
    .setDescription('Selecione o vencedor da partida abaixo.');
}

function montarEmbedVencedorDefinido(partida) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('🏆 Vencedor da Partida')
    .setDescription(`O jogador <@${partida.vencedorId}> venceu esta partida e ganhou **+1 Vitória**!`);
}

function montarSelectTipoVitoria() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ficha_tipo_vitoria')
    .setPlaceholder('Selecione uma opção')
    .addOptions(
      { label: 'Vencedor por W.O.', value: 'wo' },
      { label: 'Vencedor por Vitória', value: 'vitoria' }
    );
  return new ActionRowBuilder().addComponents(select);
}

function montarEmbedPartidaEncerrada(porWO) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: NOME_ORG })
    .setTitle(porWO ? '✅ Aposta finalizada, vencedor por W.O.' : '✅ Aposta finalizada')
    .setDescription('Estou armazenando as mensagens dessa aposta.\n↪️ Esse tópico está sendo finalizado.');
}

function pegarDadosMediador(mediadorId) {
  const dados = MEDIADOR_PIX[mediadorId];
  if (!dados) return null;
  // compatibilidade com cadastros antigos (salvos como texto puro)
  if (typeof dados === 'string') return { chave: dados, nome: null, qrcodeUrl: null };
  return dados;
}

// Identifica o tipo de uma chave Pix pelo formato.
// Gera o QR code do Pix grande (400x400) com o emoji das abelhas
// centralizado por cima, com fundo branco atrás pra não atrapalhar a
// leitura (o QR usa correção de erro alta, então aguenta ter até ~30%
// coberto no meio sem parar de funcionar).
async function gerarQrComLogo(chave) {
  const bufferQr = await QRCode.toBuffer(chave, { width: 500, margin: 1, errorCorrectionLevel: 'H' });
  const imagemQr = await Jimp.read(bufferQr);

  try {
    const logo = await Jimp.read(EMOJI_ABELHAS_URL);
    const tamanhoLogo = Math.floor(imagemQr.bitmap.width * 0.22);
    logo.resize(tamanhoLogo, tamanhoLogo);

    // fundo branco quadrado atrás do logo, um pouco maior que ele,
    // pra destacar e não misturar com os quadradinhos do QR
    const fundo = new Jimp(tamanhoLogo + 20, tamanhoLogo + 20, 0xffffffff);

    const x = (imagemQr.bitmap.width - fundo.bitmap.width) / 2;
    const y = (imagemQr.bitmap.height - fundo.bitmap.height) / 2;
    imagemQr.composite(fundo, x, y);
    imagemQr.composite(logo, x + 10, y + 10);
  } catch (err) {
    console.error('⚠️ Não consegui colocar o emoji no meio do QR code (gerando sem ele):', err.message);
  }

  return imagemQr.getBufferAsync(Jimp.MIME_PNG);
}

function detectarTipoChavePix(chave) {
  const valor = (chave || '').trim();
  if (/^\d{11}$/.test(valor.replace(/[.\-]/g, ''))) return 'CPF';
  if (/^\d{14}$/.test(valor.replace(/[.\-/]/g, ''))) return 'CNPJ';
  // Telefone: aceita qualquer quantidade de dígitos, com ou sem
  // espaço/parênteses/traço (ex: "11 98888-7777", "+55 11988887777").
  if (/^\+?\d+$/.test(valor.replace(/[\s()\-]/g, ''))) return 'Telefone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return 'E-mail';
  // Chave aleatória (EVP): formato padrão de UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) return 'Aleatória';
  // Qualquer outra coisa que não bateu em nenhum formato acima também
  // é tratada como chave aleatória (o bot reconhece e aceita normal).
  return 'Aleatória';
}

// Cor aleatória (azul ou verde) pras mensagens de aviso do bot.
function corAvisoBot() {
  return Math.random() < 0.5 ? 0x3498db : 0x2ecc71;
}

function embedAvisoBot(texto) {
  return new EmbedBuilder().setColor(corAvisoBot()).setDescription(texto);
}

// Máximo de filas simultâneas que a mesma pessoa pode ocupar ao mesmo
// tempo, contando TODOS os painéis (não só o mesmo formato).
const MAX_FILAS_SIMULTANEAS = 2;

function contarFilasDoUsuario(userId) {
  let total = 0;
  for (const instancia of painelInstancias.values()) {
    for (const chave of Object.keys(instancia.filas)) {
      if (instancia.filas[chave].includes(userId)) total++;
    }
  }
  return total;
}

function pegarChavePix(mediadorId) {
  const dados = pegarDadosMediador(mediadorId);
  return (dados && dados.chave) || PIX_PADRAO;
}

// ---------- PAINEL DE CADASTRO PIX (mediadores se cadastram sozinhos) ----------

// ---------- BLACKLIST (verificar ID do Free Fire) ----------

// ---------- PAINEL DE TELA (Google Meet) ----------

function montarEmbedPainelTela() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('🖥️ Tela — Análise de Jogador')
    .setDescription('Clique no botão abaixo para abrir um tópico privado e fazer a análise por Google Meet.');
}

function montarBotoesPainelTela() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tela_google_meet').setLabel('Google Meet').setEmoji('🎥').setStyle(ButtonStyle.Success)
  );
}

function montarEmbedInstrucoesGoogleMeet(usuario) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('🎥 Como criar a chamada no Google Meet')
    .setDescription(
      `Olá, <@${usuario.id}>! Siga os passos abaixo pra abrir a análise:\n\n` +
        '**1.** Acesse **meet.google.com** (ou abra o app do Google Meet).\n' +
        '**2.** Clique em **"Nova reunião"** → **"Iniciar uma reunião instantânea"**.\n' +
        '**3.** Copie o link que aparecer na barra de endereço (ou no botão de compartilhar).\n' +
        '**4.** Cole o link aqui nesse tópico pra registrar a análise.\n\n' +
        'Quando terminar, é só clicar em **Sair** abaixo pra fechar esse tópico.'
    );
}

function montarBotoesTelaAtiva() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tela_sair').setLabel('Sair').setEmoji(EMOJI_SAIR).setStyle(ButtonStyle.Danger)
  );
}

// ---------- PAINEL DE SALAS AUTOMÁTICAS ----------

function montarEmbedPainelSalasAutomaticas() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('🤖 Salas Automáticas')
    .setDescription('Escolha uma opção abaixo: crie uma sala nova ou veja quantas salas ainda restam no estoque.');
}

function montarBotoesPainelSalasAutomaticas() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('salasbot_criar').setLabel('Criar Sala').setEmoji('🎮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('salasbot_estoque').setLabel('Salas Restantes').setEmoji('📦').setStyle(ButtonStyle.Secondary)
  );
}

function montarEmbedPainelBlacklist() {
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('Blacklist')
    .setDescription('Clique no botão abaixo para verificar um ID na blacklist.');
}

function montarBotoesPainelBlacklist() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('blacklist_verificar').setLabel('Verificar ID').setEmoji('🔍').setStyle(ButtonStyle.Secondary)
  );
}

function montarModalBlacklist() {
  const modal = new ModalBuilder().setCustomId('modal_blacklist').setTitle('Verificação de ID na Blacklist');

  const inputId = new TextInputBuilder()
    .setCustomId('input_id_blacklist')
    .setLabel('Digite o ID que você deseja verificar:')
    .setPlaceholder('Ex: 123456789')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(inputId));
  return modal;
}

function montarEmbedResultadoBlacklist(id, registro) {
  if (registro) {
    return new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🚫 ID encontrado na Blacklist')
      .addFields(
        { name: 'ID:', value: id },
        { name: 'Motivo:', value: registro.motivo || 'Não informado' }
      );
  }
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ ID não está na Blacklist')
    .addFields({ name: 'ID:', value: id });
}

function montarEmbedPainelPix() {
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('Painel de Cadastro PIX Mediador')
    .setDescription('Clique nos botões abaixo para verificar ou cadastrar sua chave PIX.');
}

function montarBotoesPainelPix() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mediador_cadastrar_pix').setLabel('Cadastrar Pix').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mediador_verificar_cadastro').setLabel('Verificar Cadastro').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mediador_gerar_novo_pix').setLabel('Gerar Novo Pix').setEmoji(EMOJI_GIRO_OURO).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mediador_excluir_pix').setLabel('Excluir Pix').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );
}

function montarModalCadastroMediador() {
  const modal = new ModalBuilder().setCustomId('modal_cadastro_mediador').setTitle('Cadastro Mediador');

  const inputPix = new TextInputBuilder()
    .setCustomId('input_pix')
    .setLabel('Informe a chave PIX.')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const inputNome = new TextInputBuilder()
    .setCustomId('input_nome')
    .setLabel('Informe seu nome. (Opcional)')
    .setPlaceholder('Nome que irá aparecer na hora do pagamento')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const inputQrcode = new TextInputBuilder()
    .setCustomId('input_qrcode')
    .setLabel('Link da imagem do QR Code. (Opcional)')
    .setPlaceholder('Caso não tenha, será gerado automaticamente.')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputPix),
    new ActionRowBuilder().addComponents(inputNome),
    new ActionRowBuilder().addComponents(inputQrcode)
  );

  return modal;
}

function montarModalGerarNovoPix() {
  const modal = new ModalBuilder().setCustomId('modal_gerar_novo_pix').setTitle('Gerar Novo Pix');

  const inputPix = new TextInputBuilder()
    .setCustomId('input_pix')
    .setLabel('Informe a nova chave PIX.')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const inputNome = new TextInputBuilder()
    .setCustomId('input_nome')
    .setLabel('Informe seu nome. (Opcional)')
    .setPlaceholder('Nome que irá aparecer na hora do pagamento')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const inputQrcode = new TextInputBuilder()
    .setCustomId('input_qrcode')
    .setLabel('Link da imagem do novo QR Code. (Opcional)')
    .setPlaceholder('Caso não tenha, será gerado automaticamente.')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputPix),
    new ActionRowBuilder().addComponents(inputNome),
    new ActionRowBuilder().addComponents(inputQrcode)
  );

  return modal;
}

function montarEmbedCadastroMediador(usuario, dados) {
  const nomeExibicao = dados.nome && dados.nome.trim() ? dados.nome.trim() : usuario.username;

  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setAuthor({ name: usuario.username, iconURL: usuario.displayAvatarURL() })
    .setTitle(`Cadastro de ${nomeExibicao}`)
    .addFields(
      { name: 'Mediador:', value: `<@${usuario.id}>` },
      { name: 'Nome:', value: nomeExibicao },
      { name: 'Chave:', value: `\`${dados.chave}\`` }
    );
}

function montarBotoesCadastroMediador() {
  // Painel de cadastro Pix não leva mais botão de Regras.
  return null;
}

// ---------- MENSAGENS AUXILIARES ----------

function montarEmbedNotificacaoBonita(partida) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('✅ Partida Confirmada!')
    .setDescription(`${partida.jogadores.map((id) => `<@${id}>`).join(', ')} confirmaram a partida.\nBoa sorte! 🍀`);
}

function montarEmbedValorPix(partida) {
  const chave = pegarChavePix(partida.mediadorId) || PIX_PADRAO || 'Não configurada';
  const valorMediador = calcularValorMediador(partida.valor) || partida.valor || 'R$0,00';
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .addFields(
      { name: 'Valor:', value: `↳ ${valorMediador}` },
      { name: 'CHAVE PIX:', value: `${chave}` }
    );
}

function montarEmbedAguardandoPagamento(partida) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('⏳ Aguardando pagamento')
    .setDescription(
      `Sala recebida! Aguardando o pagamento da taxa de inscrição no valor de **${partida.valor}** para liberar a sala.`
    );
}

// ---------- SALA (ID/SENHA) — só Mediador/CEO pode gerar e mexer ----------

// Nome do canal quando vira "pagar": "pagar-R$50,00💰" (valor formatado
// bonitinho, com vírgula, e o emoji de dinheiro do lado direito).
function nomeCanalPagar(valor) {
  return `pagar-${valor}💰`;
}

function montarEmbedSala(partida) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle('🎮 ID e Senha')
    .addFields(
      { name: 'ID e Senha:', value: `${partida.salaId}\n${partida.salaSenha}`, inline: true },
      { name: 'Valor e Modo:', value: `${partida.valor}\n${partida.rotuloFormato}`, inline: true }
    );
}

function montarBotoesSala() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sala_copiar_id').setLabel('Copiar ID').setEmoji(EMOJI_COPIAR).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sala_trocar_valor').setLabel('Trocar Valor').setEmoji(EMOJI_GIRO).setStyle(ButtonStyle.Secondary)
  );
}

// Valores disponíveis pra troca rápida — 💵 nos maiores (50/100), 💸 nos demais.
const VALORES_TROCA_RAPIDA = ['1,00', '2,00', '3,00', '5,00', '10,00', '20,00', '50,00', '100,00'];

function montarSelectTrocarValor() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('sala_valor_escolhido')
    .setPlaceholder('Escolha o novo valor')
    .addOptions(
      VALORES_TROCA_RAPIDA.map((v) => ({
        label: `R$ ${v}`,
        value: v,
        emoji: v === '50,00' || v === '100,00' ? '💵' : '💸',
      }))
    );
  return new ActionRowBuilder().addComponents(select);
}

// Extrai (ID de 9 dígitos, senha de 2 a 4 dígitos) de uma mensagem de
// texto — funciona tanto pra "12345678 9 12" numa linha só quanto pra
// ID e senha em linhas separadas.
function extrairIdESenha(texto) {
  const match = texto.match(/(\d{9})\D+(\d{2,4})\b/);
  if (!match) return null;
  return { id: match[1], senha: match[2] };
}

// Pra quando o Mediador manda o ID e a senha em mensagens SEPARADAS
// (uma com só o ID, outra logo depois só com a senha), em vez de tudo
// na mesma mensagem.
function extrairApenasId(texto) {
  const match = texto.trim().match(/^\D*(\d{9})\D*$/);
  return match ? match[1] : null;
}
function extrairApenasSenha(texto) {
  const match = texto.trim().match(/^\D*(\d{2,4})\D*$/);
  return match ? match[1] : null;
}

// Ativa o card "ID e Senha" da sala: guarda id/senha na partida,
// renomeia o tópico pra "pagar-<valor>" e posta o embed com os botões.
async function ativarSala(canal, partida, id, senha) {
  partida.salaId = id;
  partida.salaSenha = senha;
  partida.aguardandoPagamento = true;
  delete partida.salaIdPendente;
  salvarPartidas();

  await canal.setName(nomeCanalPagar(partida.valor)).catch(() => {});

  partida.salaMessage = await canal.send({
    embeds: [montarEmbedSala(partida)],
    components: [montarBotoesSala()],
  });

  // última mensagem do fluxo inteiro da partida
  await canal.send({ embeds: [montarEmbedAnalisesFuncionando()] }).catch(() => {});
}

function montarEmbedMudouTela() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setTitle('📢 MUDOU A FORMA DE MOSTRAR A TELA')
    .setDescription(
      '**O Discord suspendeu as transmissões ao vivo no Brasil. Agora é pelo app Google Meet.**\n\n' +
        '➡️📲 Baixe agora, antes de jogar:\n' +
        `Android: ${LINK_ANDROID}\n` +
        `IOS: ${LINK_IOS}\n` +
        `Windows: ${LINK_WINDOWS}`
    );
}

// Card de regras (traço amarelo) mandado logo depois que os dois
// confirmam — penúltima mensagem do fluxo (a última é o aviso de
// "Análises Funcionando" quando a sala é criada).
function montarEmbedRegrasPadrao() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setTitle('📢 REGRAS PADRÃO - LEIA ANTES DE JOGAR')
    .setDescription(
      'A partir de agora, todas as filas seguirão:\n\n' +
        '➡️ Armas: apenas FULL UMP e XM8\n' +
        '➡️ 1º round: apenas Desert\n' +
        '➡️ Proibido mobilador nas filas mobile\n' +
        '➡️ Proibido tela parada\n' +
        '➡️ Proibido bug de kit\n\n' +
        'Não será mais necessário fazer combinações ou enviar placas para essas regras.\n\n' +
        '🔍 Mais agilidade e menos discussões antes das filas.'
    );
}

// Card de "análises funcionando" (traço amarelo) — mandado quando a
// sala (ID e Senha) é criada. É a ÚLTIMA mensagem do fluxo da partida.
function montarEmbedAnalisesFuncionando() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setTitle('🔍 ANÁLISES FUNCIONANDO NORMALMENTE!')
    .setDescription(
      'Peça a **tela como de costume**. O bot irá gerar o link do **Google Meet** automaticamente.\n\n' +
        'Ao entrar no Meet, envie o link para o restante do seu time.'
    );
}

// ---------- FILA DE MEDIADORES (Entrar / Sair / pega o próximo) ----------

// Lista em memória, ordem = ordem de chegada (fila FIFO).
const filaMediadores = [];

// Referências das mensagens dos painéis, pra poder atualizar sozinhas
// quando alguém entra, sai, ou é chamado pra uma partida. Dá pra ter
// mais de um painel de fila de mediador aberto ao mesmo tempo (em
// canais diferentes, por exemplo) — todos mostram a MESMA fila
// (filaMediadores é uma só), só a numeração no título muda.
let paineisMediador = [];

function montarEmbedFilaMediador(numero, total) {
  const linhas = filaMediadores.map((id, i) => `${i + 1}. <@${id}>`);
  const titulo = total > 1 ? `🎮 Filas dos Mediadores (${numero})` : '🎮 Filas dos Mediadores';

  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle(titulo)
    .setDescription('Entre na fila para começar a mediar apostas')
    .addFields({
      name: '\u200b',
      value: linhas.length ? linhas.join('\n') : 'Nenhum mediador na fila.',
    });
}

function montarBotoesFilaMediador() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fila_mediador_entrar').setLabel('Entrar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fila_mediador_sair').setLabel('Sair').setStyle(ButtonStyle.Danger)
  );
}

// Atualiza TODOS os painéis de fila de mediador abertos no momento —
// precisa ser todos de uma vez (e não só o que mudou) porque a
// numeração "(1)", "(2)" de cada um depende de quantos painéis
// existem no total.
async function atualizarPainelMediadorSeExistir() {
  if (!paineisMediador.length) return;
  const total = paineisMediador.length;

  await Promise.all(
    paineisMediador.map(async (msg, indice) => {
      try {
        await msg.edit({
          embeds: [montarEmbedFilaMediador(indice + 1, total)],
          components: [montarBotoesFilaMediador()],
        });
      } catch (err) {
        console.error('Erro ao atualizar painel de mediadores:', err);
      }
    })
  );
}

// ---------- FILA DE SUPORTE (Entrar / Sair) ----------
const filaSuporte = [];
let painelSuporteFilaMessage = null;

function montarEmbedFilaSuporte() {
  const linhas = filaSuporte.map((id, i) => `${i + 1}. <@${id}>`);
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('🎧 Fila de Suporte')
    .setDescription('Entre na fila para ficar disponível para atender tickets.')
    .addFields({
      name: '\u200b',
      value: linhas.length ? linhas.join('\n') : 'Nenhum suporte na fila.',
    });
}

function montarBotoesFilaSuporte() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fila_suporte_entrar').setLabel('Entrar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fila_suporte_sair').setLabel('Sair').setStyle(ButtonStyle.Danger)
  );
}

async function atualizarPainelSuporteFilaSeExistir() {
  if (!painelSuporteFilaMessage) return;
  try {
    await painelSuporteFilaMessage.edit({
      embeds: [montarEmbedFilaSuporte()],
      components: [montarBotoesFilaSuporte()],
    });
  } catch (err) {
    console.error('Erro ao atualizar painel de fila de suporte:', err);
  }
}

// ---------- CADASTRO PIX DO SUPORTE (painel) ----------
function montarEmbedPainelPixSuporte() {
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('Painel de Cadastro PIX Suporte')
    .setDescription('Clique nos botões abaixo para verificar ou cadastrar sua chave PIX.');
}
function montarBotoesPainelPixSuporte() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suporte_cadastrar_pix').setLabel('Cadastrar Pix').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('suporte_verificar_cadastro').setLabel('Verificar Cadastro').setStyle(ButtonStyle.Secondary)
  );
}
function montarModalCadastroSuporte() {
  const modal = new ModalBuilder().setCustomId('modal_cadastro_suporte').setTitle('Cadastro Pix Suporte');
  const inputPix = new TextInputBuilder().setCustomId('input_pix').setLabel('Informe a chave PIX.').setStyle(TextInputStyle.Short).setRequired(true);
  const inputNome = new TextInputBuilder()
    .setCustomId('input_nome')
    .setLabel('Informe seu nome. (Opcional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(inputPix), new ActionRowBuilder().addComponents(inputNome));
  return modal;
}
function montarEmbedPixSuporte(suporteId) {
  const dados = SUPORTE_PIX[suporteId];
  if (!dados) {
    return new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Sem Pix cadastrado')
      .setDescription('Essa pessoa ainda não se cadastrou no painel de cadastro Pix do suporte.');
  }
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('💳 Pix do Suporte')
    .addFields({ name: 'Nome:', value: dados.nome || 'Não informado' }, { name: 'Chave Pix:', value: dados.chave });
}

// ---------- RANKING DE SUPORTE ----------
function montarBotoesPainelRankingSuporte() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rankingsuporte_ver').setLabel('Ranking').setEmoji(EMOJI_COROA_2).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rankingsuporte_meuperfil').setLabel('Meu Perfil').setEmoji(EMOJI_TROFEU).setStyle(ButtonStyle.Secondary)
  );
}
function montarEmbedMeuPerfilSuporte(usuario) {
  const dados = pegarDadosSuporte(usuario.id);
  const horas = segundosAcumulados(dados);
  const total = somarGanhosDesde(dados.ganhos, 0);
  const mediaHora = horas > 0 ? total / (horas / 3600) : 0;
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setAuthor({ name: `Perfil de ${usuario.username} (Suporte)`, iconURL: usuario.displayAvatarURL() })
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .addFields(
      { name: `${EMOJI_DINDIN} Total:`, value: formatarValorBR(total) },
      { name: `${EMOJI_PROGRESSO} Horas trabalhando:`, value: formatarHoras(horas) },
      { name: `${EMOJI_MNRAMIO} Média/hora:`, value: formatarValorBR(mediaHora) },
      { name: 'Atendimentos feitos:', value: `${dados.atendimentos}` }
    );
}
async function montarEmbedRankingSuporte(guild, usuarioId) {
  const ordenado = Object.entries(DADOS_SUPORTE).sort((a, b) => (b[1].atendimentos || 0) - (a[1].atendimentos || 0));
  const top10 = ordenado.slice(0, 10);
  const linhas = await Promise.all(
    top10.map(async ([id, dados], i) => {
      const nome = await pegarNomeExibicao(guild, id);
      const marca = i === 0 ? `${EMOJI_COROA} ` : `${i + 1}. `;
      return `${marca}${nome} — ${dados.atendimentos || 0} atendimentos`;
    })
  );
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle('🎧 Ranking de Suporte')
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .setDescription(linhas.length ? linhas.join('\n') : 'Ninguém tem atendimentos registrados ainda.');
}

// ---------- SISTEMA DE TICKETS (Atendimento: Suporte / Reembolso) ----------

function montarEmbedPainelAtendimento() {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: NOME_ORG })
    .setTitle(`👤 | Atendimento ${NOME_ORG}`)
    .setDescription(
      `🎧 **Suporte**: Tire dúvidas e fale com nossa equipe\n💰 **Reembolso**: Resolva questões de pagamentos\n\n` +
        'Selecione abaixo o tipo de atendimento. Certifique-se de já ter lido as **regras** do servidor.'
    );
}

function montarSelectAtendimento() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('atendimento_menu')
    .setPlaceholder('Selecione o tipo de atendimento...')
    .addOptions(
      { label: 'Suporte', description: 'Dúvidas, problemas gerais ou ajuda', value: 'suporte', emoji: '📢' },
      { label: 'Reembolso', description: 'Solicite o reembolso de um pagamento', value: 'reembolso', emoji: '💰' }
    );
  return new ActionRowBuilder().addComponents(select);
}

function montarModalReembolso() {
  const modal = new ModalBuilder().setCustomId('modal_reembolso').setTitle('Informações de Pagamento');
  const inputPix = new TextInputBuilder()
    .setCustomId('input_chave_pix')
    .setLabel('Chave PIX')
    .setPlaceholder('Ex: email@exemplo.com ou CPF')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const inputNome = new TextInputBuilder()
    .setCustomId('input_nome_completo')
    .setLabel('Nome Completo do Titular')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const inputValor = new TextInputBuilder()
    .setCustomId('input_valor')
    .setLabel('Valor do Reembolso (R$)')
    .setPlaceholder('Ex: R$ 50,00')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(inputPix),
    new ActionRowBuilder().addComponents(inputNome),
    new ActionRowBuilder().addComponents(inputValor)
  );
  return modal;
}

function montarEmbedTicketReembolso(usuario, dados) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: `| Ticket ${NOME_ORG}` })
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .addFields(
      { name: 'Usuário:', value: `<@${usuario.id}>` },
      { name: 'Aberto em:', value: `<t:${Math.floor(Date.now() / 1000)}:R>` },
      { name: 'Assunto:', value: 'Reembolso' },
      { name: '\u200b', value: 'Olá! Envie o resumo do seu problema e aguarde um suporte.' },
      {
        name: '📄 Informações',
        value: `Chave PIX: ${dados.chave}\nNome Completo: ${dados.nome}\nValor do Reembolso: ${dados.valor}`,
      }
    );
}

function montarBotoesTicketReembolso() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_informar_nome').setLabel('Informar por Nome').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_resolvido').setLabel('Resolvido').setStyle(ButtonStyle.Secondary)
  );
}

function montarModalInformarNome() {
  const modal = new ModalBuilder().setCustomId('modal_informar_nome').setTitle('Indicar Mediador');
  const input = new TextInputBuilder()
    .setCustomId('input_nome_mediador')
    .setLabel('Nome completo, nome do Pix ou @menção')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// As 4 opções mais comuns de suporte + "Outros".
function montarSelectProblemaSuporte() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('suporte_menu_problema')
    .setPlaceholder('Qual é o seu problema?')
    .addOptions(
      { label: 'Dúvida sobre as regras', value: 'duvida_regras', emoji: '📚' },
      { label: 'Problema com pagamento', value: 'problema_pagamento', emoji: '💳' },
      { label: 'Erro ou bug no bot', value: 'erro_bot', emoji: '🐛' },
      { label: 'Denunciar um jogador', value: 'denunciar_jogador', emoji: '🚨' },
      { label: 'Outros', value: 'outros', emoji: '❓' }
    );
  return new ActionRowBuilder().addComponents(select);
}

function montarEmbedTicketSuporte(usuario, assunto, descricao) {
  return new EmbedBuilder()
    .setColor(COR_AMARELA)
    .setAuthor({ name: `| Ticket ${NOME_ORG}` })
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .addFields(
      { name: 'Usuário:', value: `<@${usuario.id}>` },
      { name: 'Aberto em:', value: `<t:${Math.floor(Date.now() / 1000)}:R>` },
      { name: 'Assunto:', value: assunto },
      { name: '\u200b', value: 'Olá! Envie o resumo do seu problema e aguarde um suporte.' },
      { name: '📄 Informações', value: `Descrição: ${descricao}` }
    );
}

function montarBotoesTicketSuporte() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_resolvido').setLabel('Resolvido').setStyle(ButtonStyle.Secondary)
  );
}

// Pega (e remove) o primeiro mediador da fila. Retorna null se a fila
// estiver vazia -> nesse caso a ficha da partida mostra "Nenhum
// mediador disponível no momento."
async function pegarProximoMediador() {
  if (!filaMediadores.length) return null;
  const mediadorId = filaMediadores.shift();
  // devolve pro fim da fila (revezamento) — assim, se só tiver 1
  // mediador, ele continua pegando toda partida; se tiver vários, cada
  // um pega na sua vez, de forma justa.
  filaMediadores.push(mediadorId);
  await atualizarPainelMediadorSeExistir();
  return mediadorId;
}

// ---------- PAINÉIS DE RANKING (jogador / ranking-adm) ----------

function montarBotoesPainelRanking() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ranking_ver').setLabel('Ranking').setEmoji(EMOJI_COROA_2).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ranking_meuperfil').setLabel('Meu Perfil').setEmoji(EMOJI_TROFEU).setStyle(ButtonStyle.Secondary)
  );
}

function montarBotoesPainelRankingAdm() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rankingadm_ver').setLabel('Ranking').setEmoji(EMOJI_COROA_2).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rankingadm_meuperfil').setLabel('Meu Perfil').setEmoji(EMOJI_TROFEU).setStyle(ButtonStyle.Secondary)
  );
}

function montarEmbedPainelRankingGenerico(titulo, descricao) {
  return new EmbedBuilder().setColor(COR_DOURADA).setTitle(titulo).setThumbnail(EMOJI_ORG_URL).setDescription(descricao);
}

function montarEmbedMeuPerfilJogador(usuario) {
  const vitorias = RANKING_VITORIAS[usuario.id] || 0;
  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setAuthor({ name: `Perfil de ${usuario.username}`, iconURL: usuario.displayAvatarURL() })
    .setThumbnail(usuario.displayAvatarURL())
    .addFields({ name: 'Vitórias:', value: `${vitorias}` });
}

async function montarEmbedRankingJogadores(guild, usuarioId) {
  const ordenado = Object.entries(RANKING_VITORIAS).sort((a, b) => b[1] - a[1]);
  const top10 = ordenado.slice(0, 10);

  const linhas = await Promise.all(
    top10.map(async ([id, vitorias], i) => {
      const nome = await pegarNomeExibicao(guild, id);
      const marca = i === 0 ? `${EMOJI_COROA} ` : `${i + 1}. `;
      return `${marca}${nome} — ${vitorias} vitórias`;
    })
  );

  const embed = new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle(`${EMOJI_TROFEU} Ranking de Vitórias`)
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .setDescription(linhas.length ? linhas.join('\n') : 'Ninguém tem vitórias registradas ainda.');

  const posicao = ordenado.findIndex(([id]) => id === usuarioId);
  if (posicao >= 10) {
    embed.addFields({
      name: 'Sua posição:',
      value: `${posicao + 1}º lugar — ${RANKING_VITORIAS[usuarioId] || 0} vitórias`,
    });
  }

  return embed;
}

// Conta quantas entradas de uma lista [{ts, valor}] aconteceram a
// partir de uma data (ms) — usado pra "filas pegas" em cada período.
function contarDesde(lista, desdeTs) {
  return lista.filter((g) => g.ts >= desdeTs).length;
}

function inicioPeriodo(periodo) {
  const agora = Date.now();
  if (periodo === 'hoje') return new Date().setHours(0, 0, 0, 0);
  if (periodo === '3dias') return agora - 3 * 24 * 60 * 60 * 1000;
  if (periodo === '7dias') return agora - 7 * 24 * 60 * 60 * 1000;
  return 0; // total geral
}

const ROTULO_PERIODO = { hoje: 'Hoje', '3dias': 'Últimos 3 dias', '7dias': 'Últimos 7 dias', total: 'Total geral' };

function montarEmbedMeuPerfilAdm(usuario, periodo = 'total') {
  const dados = pegarDadosAdm(usuario.id);
  const desde = inicioPeriodo(periodo);
  const horas = segundosAcumulados(dados);
  const total = somarGanhosDesde(dados.ganhos, desde);
  const filas = contarDesde(dados.ganhos, desde);
  const mediaHora = horas > 0 ? total / (horas / 3600) : 0;

  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setAuthor({ name: `Perfil de ${usuario.username} (Mediador)`, iconURL: usuario.displayAvatarURL() })
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .setFooter({ text: ROTULO_PERIODO[periodo] })
    .addFields(
      { name: `${EMOJI_DINDIN} Total:`, value: formatarValorBR(total) },
      { name: `${EMOJI_PROGRESSO} Horas trabalhando:`, value: formatarHoras(horas) },
      { name: `${EMOJI_MNRAMIO} Média/hora:`, value: formatarValorBR(mediaHora) },
      { name: 'Filas pegas:', value: `${filas}` }
    );
}

function montarBotoesMeuPerfilAdm(periodo = 'total') {
  const estilo = (p) => (p === periodo ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('perfiladm_hoje').setLabel('Hoje').setStyle(estilo('hoje')),
    new ButtonBuilder().setCustomId('perfiladm_3dias').setLabel('3 dias').setStyle(estilo('3dias')),
    new ButtonBuilder().setCustomId('perfiladm_7dias').setLabel('7 dias').setStyle(estilo('7dias'))
  );
}

async function montarEmbedRankingAdm(guild, usuarioId) {
  const agora = Date.now();
  const seteDias = agora - 7 * 24 * 60 * 60 * 1000;
  const trintaDias = agora - 30 * 24 * 60 * 60 * 1000;

  const entradas = Object.entries(DADOS_ADM).map(([id, dados]) => ({
    id,
    semanal: somarGanhosDesde(dados.ganhos, seteDias),
    mensal: somarGanhosDesde(dados.ganhos, trintaDias),
    total: somarGanhosDesde(dados.ganhos, 0),
  }));

  async function montarTop(chave) {
    const top = entradas.filter((e) => e[chave] > 0).sort((a, b) => b[chave] - a[chave]).slice(0, 10);
    if (!top.length) return 'Ninguém registrou ganhos ainda.';
    const linhas = await Promise.all(
      top.map(async (e, i) => {
        const nome = await pegarNomeExibicao(guild, e.id);
        const marca = i === 0 ? `${EMOJI_COROA} ` : `${i + 1}. `;
        return `${marca}${nome} — ${formatarValorBR(e[chave])}`;
      })
    );
    return linhas.join('\n');
  }

  const meusDados = pegarDadosAdm(usuarioId);

  return new EmbedBuilder()
    .setColor(COR_DOURADA)
    .setTitle(`${EMOJI_TROFEU} Ranking-ADM (Mediadores)`)
    .setThumbnail(EMOJI_COLMEIA1_URL)
    .addFields(
      { name: 'Top 10 da semana:', value: await montarTop('semanal') },
      { name: 'Top 10 do mês:', value: await montarTop('mensal') },
      { name: 'Top 10 total:', value: await montarTop('total') },
      {
        name: 'Minha posição (total):',
        value: `${formatarValorBR(somarGanhosDesde(meusDados.ganhos, 0))} arrecadados · ${formatarHoras(segundosAcumulados(meusDados))} trabalhados`,
      }
    );
}

// ---------- CANCELAMENTO (compartilhado entre as duas etapas) ----------

async function executarCancelamento(thread, partida) {
  partida.cancelando = true;
  salvarPartidas();

  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setAuthor({ name: NOME_ORG })
        .setTitle('❌ Partida cancelada'),
    ],
  });

  // remove os jogadores do tópico -> Discord gera a mensagem nativa
  // "Colmeia Bot removeu @fulano do tópico" automaticamente.
  for (const jogadorId of partida.jogadores) {
    await thread.members.remove(jogadorId).catch(() => {});
  }

  partidas.delete(thread.id);
  salvarPartidas();

  await thread.delete().catch(() => {});
}

// ---------- COMANDO DE TEXTO: POSTAR PAINEL + COMANDOS DE ADMIN ----------

client.on('messageCreate', async (message) => {
 try {
  if (message.author.bot) return;

  // Dentro do tópico de uma partida, ativar o card "ID e Senha":
  // digite o ID (9 dígitos) sozinho numa mensagem, depois a senha
  // (2 a 4 dígitos) sozinha na mensagem seguinte. Cada um funciona
  // separado — não dá (nem precisa) mandar os dois juntos na mesma
  // mensagem, e ".cs" não ativa mais nada aqui (fica livre pra não
  // bater com o comando ".cs" de outro bot).
  //
  // Só Mediador/CEO pode usar, e só uma vez por partida.
  const partidaDoTopico = partidas.get(message.channelId);

  // .cs -> não mostra nenhum card, só renomeia o tópico pra
  // "pagar-<valor>" (o resto — sala, id, senha — quem cuida é outro
  // bot). Mediador/CEO, e só dentro do tópico de uma partida.
  if (
    partidaDoTopico &&
    message.content.trim().toLowerCase() === '.cs' &&
    (await membroPodeMediar(message.member, message.guild))
  ) {
    await message.channel.setName(nomeCanalPagar(partidaDoTopico.valor)).catch(() => {});
    setTimeout(() => message.delete().catch(() => {}), 2000);
    return;
  }

  if (partidaDoTopico && !partidaDoTopico.salaId && (await membroPodeMediar(message.member, message.guild))) {
    const soId = extrairApenasId(message.content);
    if (soId) {
      partidaDoTopico.salaIdPendente = soId;
      salvarPartidas();
    } else if (partidaDoTopico.salaIdPendente) {
      const soSenha = extrairApenasSenha(message.content);
      if (soSenha) {
        await ativarSala(message.channel, partidaDoTopico, partidaDoTopico.salaIdPendente, soSenha);
      }
    }
  }

  const temPermissaoAdmin =
    message.member && message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

  // !painel1x1 / !painel2x2 / !painel3x3 / !painel4x4, com variante
  // opcional (misto|emu) e um valor opcional (pode ter ponto, vírgula,
  // "R$" etc — o texto inteiro depois da variante vira o valor).
  // Ex.: "!painel1x1", "!painel1x1 R$2,00", "!painel4x4 misto R$5,00".
  // Sempre cria um único painel por comando.
  const matchPainelFormato = message.content
    .trim()
    .match(/^!painel(1x1|2x2|3x3|4x4)(?:\s+(misto|emu))?(?:\s+([\s\S]+))?$/i);

  if (matchPainelFormato) {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    const formatoChave = matchPainelFormato[1].toLowerCase();
    const variante = matchPainelFormato[2] ? matchPainelFormato[2].toLowerCase() : null;
    const valorTexto = (matchPainelFormato[3] || '').trim();
    const valor = valorTexto || VALOR_APOSTA_PADRAO;

    const instancia = criarInstanciaPainel(formatoChave, variante, valor);
    await message.channel.send({
      embeds: [montarEmbedPainel(instancia)],
      components: [montarBotoesPainel(instancia)],
    });

    await message.delete().catch(() => {});
    return;
  }

  // !painelpix -> painel de autocadastro de mediadores
  if (message.content.trim() === '!painelpix') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelPix()],
      components: [montarBotoesPainelPix()],
    });
    await message.delete().catch(() => {});
    return;
  }


  // !mudoutela -> manda o aviso "Mudou a forma de mostrar a tela" no
  // canal atual. Só quem tem o cargo de CEO pode usar, e funciona em
  // qualquer canal (o CEO escolhe onde postar).
  if (message.content.trim() === '!mudoutela') {
    if (!(await usuarioECeoMensagem(message))) {
      return message.reply('🚫 Só quem tem o cargo de CEO pode usar esse comando.');
    }

    await message.channel.send({ embeds: [montarEmbedMudouTela()] });
    await message.delete().catch(() => {});
    return;
  }

  // !painelblacklist -> painel com botão pra verificar um ID
  // !paineltela -> painel de análise por Google Meet
  if (message.content.trim() === '!paineltela') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelTela()],
      components: [montarBotoesPainelTela()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !painelsalasbot -> painel de salas automáticas (criar / estoque)
  if (message.content.trim() === '!painelsalasbot') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelSalasAutomaticas()],
      components: [montarBotoesPainelSalasAutomaticas()],
    });
    await message.delete().catch(() => {});
    return;
  }

  if (message.content.trim() === '!painelblacklist') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelBlacklist()],
      components: [montarBotoesPainelBlacklist()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !addblacklist <id> [motivo] -> adiciona um ID na blacklist (Mediador/CEO)
  const matchAddBlacklist = message.content.trim().match(/^!addblacklist\s+(\d+)\s*(.*)$/i);
  if (matchAddBlacklist) {
    if (!(await membroPodeMediar(message.member, message.guild))) {
      return message.reply('🚫 Só quem tem o cargo de mediador pode mexer na blacklist.');
    }
    const [, id, motivo] = matchAddBlacklist;
    BLACKLIST[id] = { motivo: motivo || 'Não informado', ts: Date.now() };
    salvarBlacklist(BLACKLIST);
    await message.reply(`✅ ID \`${id}\` adicionado à blacklist.`);
    return;
  }

  // !removeblacklist <id> -> remove um ID da blacklist (Mediador/CEO)
  const matchRemoveBlacklist = message.content.trim().match(/^!removeblacklist\s+(\d+)/i);
  if (matchRemoveBlacklist) {
    if (!(await membroPodeMediar(message.member, message.guild))) {
      return message.reply('🚫 Só quem tem o cargo de mediador pode mexer na blacklist.');
    }
    const id = matchRemoveBlacklist[1];
    if (!(id in BLACKLIST)) return message.reply('Esse ID não está na blacklist.');
    delete BLACKLIST[id];
    salvarBlacklist(BLACKLIST);
    await message.reply(`✅ ID \`${id}\` removido da blacklist.`);
    return;
  }

  // !painelmediador -> painel de fila de mediadores (Entrar / Sair)
  // Pode ser postado mais de uma vez (em canais diferentes, por
  // exemplo) — todos os painéis abertos passam a mostrar a mesma fila,
  // numerados "(1)", "(2)"... quando tiver mais de um ao mesmo tempo.
  if (message.content.trim() === '!painelmediador') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    const numeroDoNovo = paineisMediador.length + 1;
    const msg = await message.channel.send({
      embeds: [montarEmbedFilaMediador(numeroDoNovo, numeroDoNovo)],
      components: [montarBotoesFilaMediador()],
    });
    paineisMediador.push(msg);

    // Se já existia outro painel aberto, ele também precisa passar a
    // mostrar o número agora que não é mais o único.
    await atualizarPainelMediadorSeExistir();

    await message.delete().catch(() => {});
    return;
  }

  // !painelticket -> painel de atendimento (Suporte / Reembolso)
  if (message.content.trim() === '!painelticket') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelAtendimento()],
      components: [montarSelectAtendimento()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !painelfilasuporte -> fila de suporte (Entrar / Sair)
  if (message.content.trim() === '!painelfilasuporte') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    const msg = await message.channel.send({
      embeds: [montarEmbedFilaSuporte()],
      components: [montarBotoesFilaSuporte()],
    });
    painelSuporteFilaMessage = msg;

    await message.delete().catch(() => {});
    return;
  }

  // !painelpixsuporte -> autocadastro de pix do suporte
  if (message.content.trim() === '!painelpixsuporte') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelPixSuporte()],
      components: [montarBotoesPainelPixSuporte()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !painelrankingsuporte -> ranking dos melhores suportes
  if (message.content.trim() === '!painelrankingsuporte') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelRankingGenerico(`${EMOJI_TROFEU} Ranking-Suporte`, 'Veja seu perfil de suporte ou o ranking de atendimentos.')],
      components: [montarBotoesPainelRankingSuporte()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !painelranking -> ranking de vitórias dos jogadores
  if (message.content.trim() === '!painelranking') {
    if (message.member && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('Você não tem permissão para criar o painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelRankingGenerico(`${EMOJI_TROFEU} Ranking Colmeia`, 'Veja seu perfil ou o ranking geral de vitórias.')],
      components: [montarBotoesPainelRanking()],
    });
    await message.delete().catch(() => {});
    return;
  }

  // !painelrankingadm -> ranking de horas/ganhos dos mediadores
  if (message.content.trim() === '!painelrankingadm') {
    if (!temPermissaoAdmin) {
      return message.reply('Você não tem permissão para criar esse painel.');
    }

    await message.channel.send({
      embeds: [montarEmbedPainelRankingGenerico(`${EMOJI_TROFEU} Ranking-ADM`, 'Veja seu perfil de mediador ou o ranking de arrecadação.')],
      components: [montarBotoesPainelRankingAdm()],
    });
    await message.delete().catch(() => {});
    return;
  }

// Posta uma lista de cards { titulo, texto } cada um como embed
// separado, cor amarela — usado por !regras, !termosadm, etc.
async function postarCards(channel, cards) {
  for (const card of cards) {
    await channel.send({
      embeds: [new EmbedBuilder().setColor(COR_AMARELA).setTitle(card.titulo).setDescription(card.texto)],
    });
  }
}

// Divide um texto grande em vários embeds (até ~3900 caracteres cada,
// respeitando o limite de descrição do Discord), quebrando de
// preferência entre parágrafos — usado pros textos enormes tipo
// !regrasblacklist.
async function postarTextoEmCards(channel, tituloPrincipal, texto) {
  const paragrafos = texto.split(/\n(?=\S)/); // quebra a cada linha que começa um novo bloco
  const LIMITE = 3900;
  const blocos = [];
  let atual = '';

  for (const paragrafo of paragrafos) {
    const candidato = atual ? `${atual}\n${paragrafo}` : paragrafo;
    if (candidato.length > LIMITE && atual) {
      blocos.push(atual);
      atual = paragrafo;
    } else {
      atual = candidato;
    }
  }
  if (atual) blocos.push(atual);

  for (let i = 0; i < blocos.length; i++) {
    const embed = new EmbedBuilder().setColor(COR_AMARELA).setDescription(blocos[i]);
    if (i === 0 && tituloPrincipal) embed.setTitle(tituloPrincipal);
    await channel.send({ embeds: [embed] });
  }
}

  // !regras -> posta as regras em vários cards separados, cor amarela
  if (message.content.trim() === '!regras') {
    if (!temPermissaoAdmin) {
      return message.reply('Você não tem permissão para postar as regras.');
    }

    const cards = [
      {
        titulo: '✅ REGRAS GERAIS:',
        texto:
          '▫️ Jogadores podem combinar regras adicionais entre si no canal da fila.\n' +
          '▫️ O level mínimo para jogar é 15.\n' +
          '▫️ Mensagens editadas serão desconsideradas.\n' +
          '▫️ Racismo, homofobia e desrespeito com a staff não serão tolerados.\n' +
          '▫️ Em caso de quebra de regra, o time infrator deverá entregar 1 round, mesmo que tenha perdido o round.\n' +
          '▫️ O pedido de round deve ser feito no mesmo round ou no seguinte, informando o motivo.\n' +
          '▫️ É permitido finalizar o oponente no soco.\n' +
          '▫️ Não é permitido realizar o bug do kit.',
      },
      {
        titulo: '💸 DESISTÊNCIA:',
        texto: '▫️ Taxa de 10% sobre o valor total da fila. Com a sala criada, também será cobrado o valor da sala (R$ 1,00) do jogador desistente.',
      },
      {
        titulo: '💰 TAXA EM FILAS ALTAS:',
        texto: '▫️ Filas acima de R$ 50 possuem taxa de 5%.',
      },
      {
        titulo: '💾 REPLAY:',
        texto:
          '▫️ É obrigatório salvar o replay.\n' +
          '▫️ Exceção: se o replay estiver cortado ou não existir por problemas de conexão, o acusador deverá enviar clipes suspeitos para análise.\n' +
          '▫️ Caso o replay esteja normal, a partida seguirá normalmente.',
      },
      {
        titulo: '📩 BLACKLIST NO JOGO OU CORREIO:',
        texto: '▫️ Não é considerado W.O. Isso ocorre por verificação automática da Garena e não confirma irregularidade do jogador.',
      },
      {
        titulo: '➡️ TELA PARADA OU MOBILADOR:',
        texto: '▫️ Não é permitido nas filas de mobile.',
      },
      {
        titulo: '🔄 TROCA DE JOGADOR:',
        texto:
          '▫️ Se não foi combinado manter o mesmo time, é permitido trocar jogador na revanche ou ao refazer a sala.\n' +
          '▫️ Em MD3 é proibido trocar jogador.',
      },
      {
        titulo: '⏳ TEMPO PARA INICIAR A PARTIDA:',
        texto: '▫️ Os jogadores têm até 5 minutos para iniciar a partida, podendo haver prorrogação mediante autorização do administrador.',
      },
      {
        titulo: '🔄 REFAZER SALA:',
        texto: '▫️ É permitido refazer a sala a qualquer momento durante a partida mediante pagamento de R$ 1,50.',
      },
      {
        titulo: '⚠️ ALEATÓRIOS NA SALA:',
        texto: '▫️ Caso a partida inicie com jogadores aleatórios na sala, ambos os adversários pagam a sala (R$ 0,75 de cada).',
      },
      {
        titulo: '🔄 ESCOLHA INCORRETA DE PERSONAGEM OU PET:',
        texto:
          '▫️ Deve ser corrigido até o final do 2º round. Caso contrário, será aplicado W.O e os rounds jogados serão entregues ao adversário.\n' +
          '▫️ O adversário tem até o 6x6 para avisar sobre erro de personagem.',
      },
      {
        titulo: 'MAPA E POSICIONAMENTO:',
        texto:
          '❌ Proibido:\n▫️ Subir em casas.\n▫️ Caso o jogador suba por engano ao pular pneu, deve descer imediatamente sem atirar ou obter vantagem.\n\n' +
          '✅ Permitido:\n▫️ Subir em containers, skips, caixotes, caminhões, kombis e telhado de Mars.\n▫️ Plataforma do observatório e containers do observatório.\n▫️ Permitido subir até o 7º degrau em qualquer escada.',
      },
      {
        titulo: '✅ PERSONAGENS PERMITIDOS:',
        texto: '▫️ Alok, Kelly, Maxim, Leon, Maro, Moco e Laura.',
      },
      {
        titulo: '✅ PETS PERMITIDOS:',
        texto: '▫️ Dom Pisante, Punkin, Mestre Trigo, Patopinho, Falcão, Babuíno, Iéti, Shiba e Pantera Noturna.',
      },
      {
        titulo: 'ARMAS:',
        texto:
          '✅ 1º ROUND:\n▫️ Desert\n\n✅ ARMAS PERMITIDAS EM TODOS OS ROUNDS:\n▫️ USP, UMP e XM8\n\n⚠️ Atenção:\n▫️ No 1º round só é permitido utilizar Desert.',
      },
      {
        titulo: '✅ SKINS E ARMAS:',
        texto: '▫️ Skins atribuídas são permitidas.\n▫️ Não é permitido utilizar níveis nas armas.',
      },
      {
        titulo: '⚠️ COMBINAÇÃO DE ARMAS:',
        texto:
          '▫️ O padrão das partidas é UMP e XM8, não sendo necessário combinar armas antes da partida.\n' +
          '▫️ No 1º round, será permitido utilizar apenas a Desert.\n' +
          '▫️ A partir do 2º round, serão permitidas apenas UMP e XM8.',
      },
      {
        titulo: '🪖 EQUIPAMENTOS:',
        texto: '▫️ Colete nível 4 é permitido.\n▫️ Capacete nível 3 é proibido.',
      },
      {
        titulo: '🧨 GRANADAS:',
        texto: '▫️ Granadas são proibidas, exceto gel.\n▫️ Jogar granadas na base sem interferir na partida é permitido.',
      },
      {
        titulo: '🧊 MODO GELO INFINITO',
        texto:
          '⚠️ Obrigatório:\n▫️ Bater soco, fazer gelo frente a frente ou gelo inclinado para iniciar e valer a partida.\n\n' +
          '❌ Proibido:\n▫️ Se trancar.\n▫️ Usar duas armas de rush.\n▫️ Trancar o adversário dentro do gás.\n\n' +
          '⚠️ Regra de tempo:\n▫️ Aos 00:30 segundos no jogo, será permitido eliminar o adversário sem realizar bate soco ou colocar gelo.\n' +
          '▫️ Caso seja confirmado abuso dessa regra para matar após esse tempo, será aplicado W.O por anti-jogo.',
      },
      {
        titulo: '❄️ MODO GELO NORMAL',
        texto:
          '✅ Permitido:\n▫️ Se trancar.\n▫️ Usar duas armas de rush.\n▫️ Trancar o adversário dentro do gás.\n\n' +
          '⚠️ Atenção:\n▫️ Combinados bate soco qualquer dano antes do bate soco e colocação de gelo resulta em entrega de round.',
      },
      {
        titulo: '❌ REGRAS ABUSIVAS (PROIBIDAS)',
        texto:
          'Os jogadores não podem criar regras abusivas ou sem sentido para impor a outros participantes. Para evitar injustiças e garantir partidas equilibradas, ficam proibidas as seguintes práticas:\n\n' +
          '▫️ Exigir sem tela.\n▫️ Obrigar o uso ou proibir skins específicas.\n▫️ Full UMP sem XM8.\n▫️ Sem x86.\n' +
          '▫️ Proibir determinadas armas sem justificativa, como UMP Roxa e XM8 Roxa.\n▫️ Mentir o nick.\n▫️ Se matar para o gás impedindo o adversário de entregar round.',
      },
      {
        titulo: '⚠️ COMBINADOS ENTRE JOGADORES:',
        texto:
          '▫️ Toda regra proposta pelo adversário será considerada aceita automaticamente caso não seja recusada. Caso o jogador não concorde, deve recusar antes do "GO".\n' +
          '▫️ Ao dizer "GO", o jogador confirma que aceita todas as regras combinadas.\n' +
          '▫️ Caso o jogador responda adicionando outra regra sem recusar a anterior, será considerado que aceitou todas as regras anteriores mais a nova.\n' +
          '▫️ Placas com conteúdo pornográfico não são permitidas. Caso sejam utilizadas, a regra será anulada automaticamente.',
      },
      {
        titulo: '🤖 DÚVIDAS:',
        texto:
          '▫️ Devem ser resolvidas no canal de tickets antes da partida.\n\n**LEIA TODAS AS REGRAS COM ATENÇÃO E RESPEITE A ORGANIZAÇÃO.**',
      },
    ];

    await postarCards(message.channel, cards);
    await message.delete().catch(() => {});
    return;
  }

  // !regrasadm -> diretrizes oficiais pro cargo de mediador/adm
  if (message.content.trim() === '!regrasadm') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para postar isso.');

    await postarCards(message.channel, [
      {
        titulo: '👑 DIRETRIZES DA COLMEIA — REGULAMENTO OFICIAL',
        texto: 'Regulamento oficial para quem exerce o cargo de ADM/Mediador na organização.',
      },
      {
        titulo: '⚖️ 1. POSTURA E NEUTRALIDADE',
        texto:
          '▫️ **Imparcialidade Total:** O ADM nunca tem lado. Mesmo que um amigo seu ou a sua própria guilda esteja jogando, as regras devem ser aplicadas com o mesmo rigor para todos.\n' +
          '▫️ **Mantenha a Calma:** O chat vai pegar fogo e haverá discussões. Nunca responda com xingamentos ou ironia. Seja frio, cite a regra violada e aplique a punição.\n' +
          '▫️ **Transparência Máxima:** Qualquer alteração de horário, troca de mapa ou punição deve ser postada no grupo principal de forma clara, explicando o motivo.',
      },
      {
        titulo: '💸 2. GERENCIAMENTO FINANCEIRO',
        texto:
          '▫️ **Tabela de Caixa:** Mantenha uma planilha (ou bloco de notas) com o nome de quem pagou, o comprovante de PIX salvo e o horário. Nunca confie apenas na memória.\n' +
          '▫️ **Separação de Dinheiro:** Jamais misture o dinheiro das inscrições com a sua conta bancária pessoal do dia a dia. Deixe o valor do prêmio intacto até o final do evento.\n' +
          '▫️ **Velocidade no Pagamento:** Pague o vencedor o mais rápido possível após a validação. ADM que demora para pagar ganha fama de "caloteiro" muito rápido.',
      },
      {
        titulo: '🎮 3. ORGANIZAÇÃO DA SALA E DO JOGO',
        texto:
          '▫️ **Pontualidade Britânica:** Se a sala está marcada para as 21:00, ela deve começar às 21:00. Não atrase o evento por causa de uma única Line que se atrasou; isso desrespeita quem chegou no horário.\n' +
          '▫️ **Conferência de Nicks:** Antes de iniciar a queda, passe o olho na sala do Free Fire e veja se os nicks batem com a tabela de inscrição. Se houver jogador "aleatório", remova da sala imediatamente.\n' +
          '▫️ **Criação de Provas:** O ADM também deve tirar prints ou gravar a tela do lobby e da tabela final do jogo para ter como contra-prova caso algum jogador tente fraudar o resultado.',
      },
      {
        titulo: '📋 4. RESOLUÇÃO DE CONFLITOS E AUDITORIA',
        texto:
          '▫️ **Análise de Vídeos (POV):** Se uma Line acusar outra de usar hack ou bug, exija a gravação da tela (POV) da equipe acusada. Defina um prazo de até 10 minutos para eles enviarem. Se recusarem ou não tiverem, a pontuação deles é zerada.\n' +
          '▫️ **Palavra Final:** Deixe claro que, após a análise das provas por você, a decisão do ADM é soberana e incontestável. Isso evita conversas intermináveis no grupo.',
      },
    ]);

    await message.delete().catch(() => {});
    return;
  }

  // !termosadm -> glossário de termos financeiros/organizacionais
  if (message.content.trim() === '!termosadm') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para postar isso.');

    await postarCards(message.channel, [
      {
        titulo: '📑 Termos de Organização e Financeiros',
        texto:
          '**Taxa de ADM:** A comissão em dinheiro ou diamantes cobrada pelo administrador para organizar o jogo e gerenciar a premiação.\n' +
          '**Tabela ou Grade:** O cronograma que mostra a divisão dos grupos, os horários de cada queda e quais times se enfrentarão.\n' +
          '**Vaga Garantida:** Confirmação de que o squad está inscrito na rodada após o envio do comprovante.\n' +
          '**Print do PIX / Comprovante:** Exigência obrigatória para confirmar a participação ou para receber a premiação.\n' +
          '**W.O. (Walkover):** Vitória automática concedida a uma equipe quando o time adversário não se apresenta no horário correto da sala.\n' +
          '**Reembolso:** Devolução do valor da inscrição caso o campeonato seja cancelado por culpa da organização.',
      },
      {
        titulo: '🎮 Termos de Partida (Regulamento de Jogo)',
        texto:
          '**ID e Senha:** As credenciais enviadas pelo ADM para que os jogadores entrem na sala personalizada do Free Fire.\n' +
          '**Print da Tela Final:** Captura de tela do resultado da partida (booyah ou pontuação), exigida pelo ADM para somar os pontos corretos na tabela.\n' +
          '**Regra do CR7 / Personagens:** Restrição de habilidades consideradas apelativas (como a bolha do Chrono ou o Alok), dependendo do combinado.\n' +
          '**Armas Banidas:** Lista de itens proibidos nas regras daquele AP específico (comum proibir Granada de Luz/Fragmentação, Lança-Granadas ou vetor dupla).\n' +
          '**Guarita ou Zé Carrinho:** Estratégias que podem ser banidas ou pontuadas negativamente (ficar camperando muito tempo em guaritas ou atropelando com veículos).',
      },
      {
        titulo: '🚫 Termos de Punição e Segurança',
        texto:
          '**Ban ou Banimento:** Expulsão permanente do jogador ou da line-up por trapaça, toxicidade ou desrespeito às regras.\n' +
          '**Blacklist (Lista Negra):** Lista compartilhada entre ADMs com nomes de jogadores tóxicos, caloteiros ou suspeitos de usar programas ilegais.\n' +
          '**Hack / Regedit / Auxílio de Mira:** Jogadores pegos usando trapaças que resultam em desclassificação imediata da equipe sem direito a reembolso.\n' +
          '**Remoção por Atraso:** Tolerância rígida (geralmente de 5 a 10 minutos). Se o time não entrar, o ADM inicia a sala sem eles.',
      },
    ]);

    await message.delete().catch(() => {});
    return;
  }

  // !termossuporte -> categorias de ticket e termos frequentes do suporte
  if (message.content.trim() === '!termossuporte') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para postar isso.');

    await postarCards(message.channel, [
      {
        titulo: '📂 Categorias Principais de Tickets (Canais mais Comuns)',
        texto:
          '▫️ **Suporte / Dúvidas Diárias:** Canal aberto para tirar dúvidas sobre horários, tabelas das salas ou regras específicas daquele apostado.\n' +
          '▫️ **Inscrições / Comprovantes:** Envio do comprovante de pagamento da taxa (Pix) e a ficha com os IDs dos jogadores para validar a vaga no campeonato.\n' +
          '▫️ **Denúncias / Reportar Jogador:** Usado para denunciar trapaças (uso de cheats/hacks) ou condutas tóxicas durante as salas premiadas.\n' +
          '▫️ **Resgate de Premiação / Reembolso:** Aberto exclusivamente pelos líderes das linhas/guildas vencedoras para enviar a chave Pix e coletar o dinheiro ganho na rodada.',
      },
      {
        titulo: '📋 Termos e Regras Frequentes nos Canais de Suporte',
        texto:
          '▫️ **Provas em Vídeo (Clip ou Gravação):** Quase todas as orgs exigem que, ao abrir um ticket de denúncia, o jogador anexe o "clip" da tela provando o ocorrido. Sem vídeo, o ticket costuma ser fechado sem análise.\n' +
          '▫️ **Dados Obrigatórios:** Geralmente a mensagem automática do bot exige que você envie o Nick exato e ID de quem está reportando e do acusado.\n' +
          '▫️ **Tempo de Resposta (SLA):** O tempo de resposta pode variar de alguns minutos a algumas horas em dias de grandes eventos. Evite marcar a Staff pra não atrasar a fila.\n' +
          '▫️ **Fechamento por Inatividade:** Se você abrir o ticket e não responder ou não mandar os dados solicitados dentro de um prazo específico (geralmente 24 horas), o bot fecha o ticket automaticamente por falta de comunicação.\n' +
          '▫️ **Punição por Ticket Falso:** Abrir chamados de brincadeira, xingar os moderadores ou tentar forjar comprovantes resulta em banimento imediato do servidor da org e desclassificação da guilda.',
      },
    ]);

    await message.delete().catch(() => {});
    return;
  }

  // !regrassuporte -> regras internas do time de suporte/reembolso
  if (message.content.trim() === '!regrassuporte') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para postar isso.');

    await postarCards(message.channel, [
      {
        titulo: '1️⃣ Regras Gerais de Atendimento (Suporte Técnico/Dúvidas)',
        texto:
          '▫️ **Cordialidade Obrigatória:** Tratar todo membro com respeito, usando saudações profissionais (ex: "Olá, [Nome], como posso te ajudar hoje?"), independentemente da grosseria do usuário.\n' +
          '▫️ **Tempo Limite de Resposta (SLA):** Todo ticket aberto deve ter uma resposta inicial em até X horas (geralmente de 2 a 12 horas, dependendo do tamanho da org).\n' +
          '▫️ **Coleta de Provas:** O suporte nunca deve fechar um ticket de erro sem pedir prints, gravações de tela ou IDs que comprovem o problema técnico alegado.\n' +
          '▫️ **Sigilo de Dados:** Proibido expor informações privadas do usuário (como e-mail, telefone ou comprovantes) em canais públicos do Discord ou redes sociais.',
      },
      {
        titulo: '2️⃣ Regras Rígidas para Tickets de Reembolso',
        texto:
          'Os tickets de reembolso são os mais sensíveis e exigem regras estritas para evitar que a organização tome prejuízo ou sofra golpes:\n\n' +
          '▫️ **Prazo de Solicitação:** O reembolso só pode ser solicitado dentro de um prazo máximo (ex: 7 dias após a compra ou até 48h antes do início do campeonato).\n' +
          '▫️ **Comprovante de Pagamento Válido:** O reembolso só pode ser processado se o usuário anexar o comprovante original do Pix ou cartão. O nome no comprovante deve bater com os dados do ticket.\n' +
          '▫️ **Motivos Elegíveis:** Válidos — instabilidade na plataforma, cancelamento do evento pela guilda, ou cobrança duplicada. Inválidos — arrependimento, ban por trapaça, ou falta no dia por descuido próprio.\n' +
          '▫️ **Estorno na Mesma Moeda/Conta:** O dinheiro deve ser devolvido estritamente para a mesma conta PIX ou cartão que realizou o pagamento original. Isso evita lavagem de dinheiro ou fraude.',
      },
      {
        titulo: '3️⃣ Procedimento Operacional (Fluxo do Ticket)',
        texto:
          '▫️ **Status do Ticket:** O analista deve categorizar o ticket corretamente (Em Aberto, Em Análise, Aguardando o Usuário ou Resolvido).\n' +
          '▫️ **Aprovação de Alçada:** O atendente de suporte analisa o caso, mas o estorno financeiro geralmente precisa da aprovação de um Diretor ou Administrador Líder antes de ser enviado.\n' +
          '▫️ **Fechamento por Inatividade:** Se o usuário abrir o ticket, o suporte responder e o usuário sumir, o ticket deve ser fechado automaticamente após 48 horas sem resposta.',
      },
    ]);

    await message.delete().catch(() => {});
    return;
  }

  // !regrasblacklist -> regulamento de análise/blacklist (texto grande)
  if (message.content.trim() === '!regrasblacklist') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para postar isso.');

    const texto = `⏳ **Solicitação de Tela:**
O jogador tem até 2 minutos para solicitar a tela com o [nick] do suspeito e informar o canal de voz da análise em aberto.

⏳ **Tempo de transmissão:**
O suspeito deve acessar no canal de voz dentro de 5 minutos.

╺╸ **Replay e Tempo**
É W.O automático se passar 5 minutos sem mostrar o replay? Não é W.O imediato! É tolerante se: o jogador informar o motivo da demora, ou se comunicar sobre a situação. Não aplicamos W.O precipitadamente.

🔎 **Verificação do Replay:**
O acusador deve analisar o replay e verificar se há algo suspeito.

📣 **Ação do Mediador:**
Se o replay parecer suspeito para o mediador, ele vai acionar um ScreenShare [Analista] da organização. Caso contrário, se estiver normal, o pagamento será feito para o vencedor da partida.

🚨 **Passando Pano:**
Caso você perceba que o [ADM] não está sendo imparcial ou justo nas análises, e esteja favorecendo outros jogadores, por favor, abra um ticket para nos informar sobre o ocorrido.

📶 **Problemas de Conexão no Replay:**
Se o replay estiver cortado por problemas de conexão, o acusador deve enviar clipes suspeitos para análise. Se o replay estiver normal, a partida segue normalmente.

🚨 **Proibição de Relogar:**
Caso o replay do acusado seja suspeito, é proibido relogar no jogo, seja em dispositivos Android, iOS ou emuladores.

🛡️ **Suspeita de WallHack:**
Se houver suspeita de WallHack, envie clipes suspeitos. Se confirmado, indique o [nick] do jogador suspeito para revisão do replay.

🚨 **Investigação com SCREENSHARE:**
Em casos de suspeita de hack, nossa equipe pode solicitar uma sessão de SCREENSHARE para uma investigação detalhada. Durante esta sessão, verificamos:

🔍 Atividades Suspeitas — software não autorizado ou comportamentos incomuns que possam indicar o uso de cheats.
⚙️ Configurações do Sistema — modificações suspeitas que possam comprometer a integridade do jogo.
📁 Registro de Atividades — logs apagados ou alterados, serviços desativados ou indício de ocultação de ações maliciosas.

🎯 Nosso objetivo é garantir um ambiente justo e seguro para todos os jogadores. Agradecemos sua cooperação durante este processo!

📱 **IOS**
✅ VPN é W.O (exceto VPN Escolar).
✅ iPhone é proibido de reiniciar durante/após a partida.
✅ iPhone obrigatório jogar com tempo de uso e relatório de privacidade ativado.
✅ iPhone versão 15.x a 16.x em apostas acima de R$50 (MD3): deve abrir tela reinstalando o jogo e entrando na sala.
✅ iPhones 15.x–16.x com App Store na bateria após a partida são passíveis de W.O.
✅ iPhones 15.x–16.x com replay suspeito são passíveis de W.O.
✅ iPhones com modo Developer ativado resultam em W.O.
✅ iOS jogando com conta em blacklist sem gravação do início ao fim = W.O imediato.
✅ É proibido relogar com replay suspeito.

📱 **ANDROID**
✅ Proibido Root.
✅ Proibido MT Manager.
✅ Play Store pós-partida pode resultar em W.O caso o analista ache necessário.
✅ Proibido jogar qualquer modo que salve replay pós-partida.
✅ Proibido qualquer tipo de arquivo ou programa que dê vantagem sobre outros jogadores.
✅ Proibido acessar Google Drive ou ZArchiver pós-partida.
✅ Navegador só será W.O caso o histórico esteja limpo.
✅ Qualquer tipo de arquivo, programa ou rastro suspeito, de janeiro de 2026 em diante, será aplicado W.O.
✅ Shader modificada é W.O.
✅ Qualquer tipo de VPN que não seja do governo ou apostas esportivas será aplicado W.O.
✅ Obrigatório ter o App Usage instalado com todas as permissões concedidas.

💻 **EMULADOR**
✅ Proibido uso de injeções ou modificações de DLL durante/após a partida (ex: ProcessHacker, CMD, Cheat Engine, etc).
✅ Proibido remover pendrive pós boot.
✅ Todos os discos devem ser NTFS com USNJournal ativo. Em caso de replay estranho, é passível de W.O.
✅ Proibido reiniciar o emulador após a partida (relogar apenas o jogo é permitido).
✅ Temp, Prefetch e Recent limpas pós boot do PC = W.O.
✅ BAM pausada/limpa = W.O.
✅ Windows modificado que impossibilite telagem = W.O.
✅ Negar acesso via AnyDesk/TeamViewer = W.O.
✅ Sysmon ativada após boot (sem reiniciar o PC) = W.O.
✅ Rastro de serviço pausado, mesmo que temporariamente = W.O.
✅ Sempre confira atualizações da Sysmon (desatualizada/modificada/replace = W.O).
✅ Placas-mãe X99: avisar o SS caso não tenha Secure Boot/TPM.
✅ Caso algum destes serviços esteja desabilitado, será W.O em replays suspeitos: PcaSvc, PlugPlay, DPS, DiagTrack, SysMain, Sysmon (By Keller), EventLog, Data Usage, TPM e Secure Boot.

🎮 **1x1**
✅ Solicitar a tela de apenas 1 jogador.

👥 **2x2**
✅ Solicitar a tela de todos os jogadores. Após assistir aos replays, o solicitante poderá encaminhar no máximo 2 jogadores suspeitos para análise do mediador.

👥 **3x3**
✅ Solicitar a tela de todos os jogadores. Após assistir aos replays, o solicitante poderá encaminhar no máximo 2 jogadores suspeitos para análise do mediador.

👥 **4x4**
✅ Solicitar a tela de todos os jogadores. Após assistir aos replays, o solicitante poderá encaminhar no máximo 2 jogadores suspeitos para análise do mediador.

📝 **Exemplo**
Em uma partida 4x4, foram solicitadas as telas dos jogadores 1, 2, 3 e 4. Após assistir aos replays de todos, o jogador que realizou a solicitação identificou suspeitas apenas nos jogadores 1 e 3. Nesse caso, somente os replays desses dois jogadores deverão ser encaminhados para análise do mediador.

⏰ **Tempo para Abrir Tela**
✅ Em caso de várias telas, todos os jogadores deverão estar com a tela aberta em até 8 minutos quando houver replay suspeito. O não cumprimento desse prazo não resulta em W.O automático.

👨‍⚖️ **Decisão do Mediador**
✅ O mediador poderá estender o prazo, quando necessário, para até 16 minutos em casos de replay normal.

🚫 **Restrições**
✅ Não é permitido solicitar tela após solicitar RV.`;

    await postarTextoEmCards(message.channel, '🛡️ Regulamento de Análise / Blacklist', texto);
    await message.delete().catch(() => {});
    return;
  }

  // !setcargoceo @cargo / !setcargomediador @cargo / !setcargosuporte
  // @cargo / !setcargosuporte @cargo — configura, direto pelo Discord,
  // qual cargo do servidor conta pra cada função. Fica salvo em arquivo
  // e já vale na hora, sem editar .env nem reiniciar o bot. Dá pra usar
  // marcando o cargo (@Cargo) ou colando o ID dele.
  // Gate: permissão "Gerenciar Servidor" do próprio Discord — assim dá
  // pra configurar isso mesmo antes de qualquer cargo/CEO existir.
  // Embed verde de "cargo configurado com sucesso" — a menção do cargo
// (<@&id>) já sai automaticamente com a cor do próprio cargo no
// Discord, sem precisar de nada especial pra isso.
function montarEmbedCargoConfigurado(nomeTipo, idCargo, extra) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setDescription(`✅ Cargo **${nomeTipo}** configurado: <@&${idCargo}> com sucesso!${extra ? `\n\n${extra}` : ''}`);
}

// Manda a resposta só na DM de quem usou o comando (assim ninguém mais
// no canal vê) e apaga a mensagem do comando. Se a DM falhar (usuário
// com DM fechada), manda no canal mesmo só que se autodestrói rapidinho.
async function responderPrivadamente(message, payload) {
  try {
    await message.author.send(payload);
  } catch (err) {
    const msg = await message.channel.send(payload).catch(() => null);
    if (msg) setTimeout(() => msg.delete().catch(() => {}), 8000);
  }
  await message.delete().catch(() => {});
}

if (message.content.trim().startsWith('!setcargoceo')) {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para usar esse comando.');
    const idCargo = extrairIdDeCargo(message);
    if (!idCargo) return message.reply('Uso correto: `!setcargoceo @cargo` (marque o cargo, ou cole o ID dele).');
    CEO_ROLE_ID = idCargo;
    salvarConfigCargo('ceoRoleId', idCargo);
    return responderPrivadamente(message, { embeds: [montarEmbedCargoConfigurado('CEO', idCargo, 'Já vale na hora, não precisa reiniciar o bot.')] });
  }

  if (message.content.trim().startsWith('!setcargomediador')) {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para usar esse comando.');
    const idCargo = extrairIdDeCargo(message);
    if (!idCargo) return message.reply('Uso correto: `!setcargomediador @cargo` (marque o cargo, ou cole o ID dele).');
    MEDIADOR_ROLE_ID = idCargo;
    salvarConfigCargo('mediadorRoleId', idCargo);
    return responderPrivadamente(message, {
      embeds: [
        montarEmbedCargoConfigurado(
          'Mediador',
          idCargo,
          'Já vale na hora: quem tiver esse cargo já pode usar Finalizar Aposta, Escolher Vencedor, W.O./Vitória e Cancelar. Se você tirar o cargo de alguém, ela perde o acesso na hora também — não precisa reiniciar o bot em nenhum dos dois casos.'
        ),
      ],
    });
  }

  if (message.content.trim().startsWith('!setcargosuporte')) {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para usar esse comando.');
    const idCargo = extrairIdDeCargo(message);
    if (!idCargo) return message.reply('Uso correto: `!setcargosuporte @cargo` (marque o cargo, ou cole o ID dele).');
    SUPORTE_ROLE_ID = idCargo;
    salvarConfigCargo('suporteRoleId', idCargo);
    return responderPrivadamente(message, { embeds: [montarEmbedCargoConfigurado('Suporte', idCargo, 'Já vale na hora, não precisa reiniciar o bot.')] });
  }

  // !vercargos — mostra os 4 cargos configurados agora (útil pra
  // conferir se está tudo certo, sem precisar abrir o .env).
  if (message.content.trim() === '!vercargos') {
    if (!temPermissaoAdmin) return message.reply('Você não tem permissão para usar esse comando.');
    return responderPrivadamente(message, {
      content:
        `**Cargos configurados agora:**\n` +
        `CEO: ${CEO_ROLE_ID ? `<@&${CEO_ROLE_ID}>` : '(não configurado)'}\n` +
        `Mediador: ${MEDIADOR_ROLE_ID ? `<@&${MEDIADOR_ROLE_ID}>` : '(não configurado)'}\n` +
        `Suporte: ${SUPORTE_ROLE_ID ? `<@&${SUPORTE_ROLE_ID}>` : '(não configurado)'}`,
    });
  }

  // !addmediadoracesso @pessoa — dá acesso de Mediador (Cancelar,
  // Finalizar Aposta, Escolher Vencedor, etc.) pra essa pessoa na hora,
  // sem precisar dar o cargo nem mexer no .env/reiniciar o bot. Só o
  // CEO/dono pode usar, já que isso dá acesso de mediador a qualquer
  // partida.
  if (message.content.trim().startsWith('!addmediadoracesso')) {
    if (!(await usuarioECeoMensagem(message))) {
      return message.reply('Só o CEO/dono pode dar acesso de mediador.');
    }

    const mencionado = message.mentions.users.first();
    if (!mencionado) {
      return message.reply('Uso correto: `!addmediadoracesso @pessoa`');
    }

    if (MEDIADORES_EXTRAS.includes(mencionado.id)) {
      return message.reply(`<@${mencionado.id}> já está na lista de mediadores.`);
    }

    MEDIADORES_EXTRAS.push(mencionado.id);
    salvarMediadoresExtras(MEDIADORES_EXTRAS);

    return message.reply(`✅ <@${mencionado.id}> agora tem acesso de Mediador (Cancelar, Finalizar Aposta, Escolher Vencedor, etc.) em qualquer partida.`);
  }

  // !removermediadoracesso @pessoa
  if (message.content.trim().startsWith('!removermediadoracesso')) {
    if (!(await usuarioECeoMensagem(message))) {
      return message.reply('Só o CEO/dono pode remover acesso de mediador.');
    }

    const mencionado = message.mentions.users.first();
    if (!mencionado) {
      return message.reply('Uso correto: `!removermediadoracesso @pessoa`');
    }

    if (!MEDIADORES_EXTRAS.includes(mencionado.id)) {
      return message.reply(`<@${mencionado.id}> não está na lista de mediadores.`);
    }

    MEDIADORES_EXTRAS = MEDIADORES_EXTRAS.filter((id) => id !== mencionado.id);
    salvarMediadoresExtras(MEDIADORES_EXTRAS);

    return message.reply(`✅ <@${mencionado.id}> foi removido da lista de mediadores.`);
  }

  // !listamediadoresacesso
  if (message.content.trim().startsWith('!listamediadoresacesso')) {
    if (!(await usuarioECeoMensagem(message))) {
      return message.reply('Só o CEO/dono pode ver essa lista.');
    }

    const linhas = MEDIADORES_EXTRAS.length
      ? MEDIADORES_EXTRAS.map((id) => `<@${id}> (${id})`).join('\n')
      : 'Ninguém adicionado por comando ainda.';

    return message.reply(`**Mediadores com acesso liberado por comando (além de quem tem o cargo):**\n${linhas}`);
  }

  // !addmediador @pessoa chavepix  (cadastro manual, feito por um admin)
  if (message.content.trim().startsWith('!addmediador')) {
    if (!temPermissaoAdmin) {
      return message.reply('Você não tem permissão para gerenciar mediadores.');
    }

    const mencionado = message.mentions.users.first();
    if (!mencionado) {
      return message.reply('Uso correto: `!addmediador @pessoa chavepix`');
    }

    // remove "!addmediador", a menção, e junta o resto como chave pix
    const partes = message.content.trim().split(/\s+/).slice(1);
    const chavePix = partes.filter((p) => !p.startsWith('<@')).join(' ').trim();

    if (!chavePix) {
      return message.reply('Uso correto: `!addmediador @pessoa chavepix`');
    }

    const erroValidacao = validarCadastroMediador(chavePix, null);
    if (erroValidacao) {
      return message.reply(`❌ Algo deu errado: ${erroValidacao}`);
    }

    MEDIADOR_PIX[mencionado.id] = { chave: chavePix, nome: null, qrcodeUrl: null };
    salvarMediadorPix(MEDIADOR_PIX);

    await message.reply(`✅ Mediador <@${mencionado.id}> cadastrado com a chave Pix: \`${chavePix}\``);
    return;
  }

  // !removermediador @pessoa
  if (message.content.trim().startsWith('!removermediador')) {
    if (!temPermissaoAdmin) {
      return message.reply('Você não tem permissão para gerenciar mediadores.');
    }

    const mencionado = message.mentions.users.first();
    if (!mencionado) {
      return message.reply('Uso correto: `!removermediador @pessoa`');
    }

    if (!(mencionado.id in MEDIADOR_PIX)) {
      return message.reply('Esse mediador não está cadastrado.');
    }

    delete MEDIADOR_PIX[mencionado.id];
    salvarMediadorPix(MEDIADOR_PIX);

    await message.reply(`🗑️ Mediador <@${mencionado.id}> removido.`);
    return;
  }

  // !listamediadores
  if (message.content.trim() === '!listamediadores') {
    if (!temPermissaoAdmin) {
      return message.reply('Você não tem permissão para ver essa lista.');
    }

    const ids = Object.keys(MEDIADOR_PIX);
    if (!ids.length) {
      return message.reply('Nenhum mediador cadastrado ainda. Use `!addmediador @pessoa chavepix`.');
    }

    const linhas = ids.map((id) => {
      const d = MEDIADOR_PIX[id];
      const chave = typeof d === 'string' ? d : d.chave;
      const nome = typeof d === 'object' && d.nome ? ` (${d.nome})` : '';
      return `• <@${id}>${nome} — \`${chave}\``;
    });
    return message.reply(`**Mediadores cadastrados:**\n${linhas.join('\n')}`);
  }
 } catch (err) {
  console.error('⚠️ Erro não tratado numa mensagem:', err);
 }
});

// ---------- INTERAÇÕES (BOTÕES) ----------

client.on('interactionCreate', async (interaction) => {
 try {
  // --- Botão "Verificar ID" da Blacklist -> abre o formulário ---
  // --- Botão "Google Meet" (painel de Tela) -> cria tópico privado ---
  if (interaction.isButton() && interaction.customId === 'tela_google_meet') {
    if (!(await usuarioECeo(interaction))) {
      return interaction.reply({ content: '🚫 Só quem tem o cargo de CEO pode usar essa opção.', ephemeral: true });
    }

    // Só 1 tópico de tela por vez por pessoa: se já existe um aberto
    // (arquivado ou não), reaproveita em vez de criar outro.
    const nomeTopicoTela = `tela-${interaction.user.username}`;
    const topicosExistentes = await interaction.channel.threads.fetchActive().catch(() => null);
    const topicoJaAberto = topicosExistentes?.threads.find((t) => t.name === nomeTopicoTela);

    if (topicoJaAberto) {
      return interaction.reply({ content: `Você já tem um tópico de tela aberto: ${topicoJaAberto}`, ephemeral: true });
    }

    const topico = await interaction.channel.threads
      .create({
        name: nomeTopicoTela,
        type: ChannelType.PrivateThread,
        reason: 'Análise por Google Meet',
      })
      .catch(() => null);

    if (!topico) {
      return interaction.reply({ content: '⚠️ Não consegui criar o tópico. Confira as permissões do bot.', ephemeral: true });
    }

    await topico.members.add(interaction.user.id).catch(() => {});

    await topico.send({
      embeds: [montarEmbedInstrucoesGoogleMeet(interaction.user)],
      components: [montarBotoesTelaAtiva()],
    });

    // mensagem separada, avisando sobre a troca pro Google Meet
    await topico.send({ embeds: [montarEmbedMudouTela()] });

    return interaction.reply({ content: `✅ Tópico criado: ${topico}`, ephemeral: true });
  }

  // --- Botão "Sair" (fecha o tópico de Tela) ---
  if (interaction.isButton() && interaction.customId === 'tela_sair') {
    await interaction.reply({ content: 'Encerrando esse tópico...' });
    await interaction.channel.delete('Análise finalizada').catch(() => {});
    return;
  }

  // --- Botões do painel de Salas Automáticas ---
  if (interaction.isButton() && ['salasbot_criar', 'salasbot_estoque'].includes(interaction.customId)) {
    if (!(await usuarioECeo(interaction))) {
      return interaction.reply({ content: '🚫 Só quem tem o cargo de CEO pode usar essa opção.', ephemeral: true });
    }

    const comando = interaction.customId === 'salasbot_criar' ? '.painel' : '.s';
    const acao = interaction.customId === 'salasbot_criar' ? 'criar uma sala' : 'ver o estoque de salas';
    const sufixo = interaction.customId === 'salasbot_criar' ? 'criar' : 'estoque';
    const nomeTopico = `salas-${sufixo}-${interaction.user.username}`;

    // Só 1 tópico por opção por vez: se já existe um aberto, reaproveita.
    const topicosExistentes = await interaction.channel.threads.fetchActive().catch(() => null);
    const topicoJaAberto = topicosExistentes?.threads.find((t) => t.name === nomeTopico);

    if (topicoJaAberto) {
      return interaction.reply({ content: `Você já tem um tópico aberto: ${topicoJaAberto}`, ephemeral: true });
    }

    const topico = await interaction.channel.threads
      .create({
        name: nomeTopico,
        type: ChannelType.PrivateThread,
        reason: 'Salas automáticas',
      })
      .catch(() => null);

    if (!topico) {
      return interaction.reply({ content: '⚠️ Não consegui criar o tópico. Confira as permissões do bot.', ephemeral: true });
    }

    await topico.members.add(interaction.user.id).catch(() => {});

    await topico.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COR_AMARELA)
          .setAuthor({ name: NOME_ORG })
          .setTitle('🤖 Como continuar')
          .setDescription(`Pra ${acao}, digite aqui neste tópico:\n\n\`${comando}\``),
      ],
    });

    // o tópico inteiro se fecha sozinho depois de 3 minutos
    setTimeout(() => topico.delete('Tempo de sala automática esgotado').catch(() => {}), 3 * 60 * 1000);

    return interaction.reply({ content: `✅ Tópico criado: ${topico}`, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'blacklist_verificar') {
    return interaction.showModal(montarModalBlacklist());
  }

  // --- Envio do formulário da Blacklist ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_blacklist') {
    const id = interaction.fields.getTextInputValue('input_id_blacklist').trim();
    const registro = BLACKLIST[id] || null;
    return interaction.reply({ embeds: [montarEmbedResultadoBlacklist(id, registro)], ephemeral: true });
  }

  // --- Botão "Cadastrar Pix" -> abre o formulário ---
  if (interaction.isButton() && interaction.customId === 'mediador_cadastrar_pix') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode cadastrar Pix aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }
    return interaction.showModal(montarModalCadastroMediador());
  }

  // --- Envio do formulário de cadastro ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_cadastro_mediador') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode cadastrar Pix aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }

    const chave = interaction.fields.getTextInputValue('input_pix').trim();
    const nome = interaction.fields.getTextInputValue('input_nome').trim();
    const qrcodeUrl = interaction.fields.getTextInputValue('input_qrcode').trim();

    const erroValidacao = validarCadastroMediador(chave, nome);
    if (erroValidacao) {
      return interaction.reply({ content: `❌ Algo deu errado: ${erroValidacao}`, ephemeral: true });
    }

    // sempre substitui o cadastro antigo (pode cadastrar de novo quantas
    // vezes quiser, sem precisar de admin remover antes)
    const dados = { chave, nome: nome || null, qrcodeUrl: qrcodeUrl || null };
    MEDIADOR_PIX[interaction.user.id] = dados;
    salvarMediadorPix(MEDIADOR_PIX);

    return interaction.reply({
      content: '✅ Cadastro salvo com sucesso!',
      embeds: [montarEmbedCadastroMediador(interaction.user, dados)],
      components: [montarBotoesCadastroMediador()].filter(Boolean),
      ephemeral: true,
    });
  }

  // --- Botão "Gerar Novo Pix" -> apaga o antigo e cadastra um novo ---
  if (interaction.isButton() && interaction.customId === 'mediador_gerar_novo_pix') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode usar isso aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }
    return interaction.showModal(montarModalGerarNovoPix());
  }

  // --- Envio do formulário de "Gerar Novo Pix" ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_gerar_novo_pix') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode usar isso aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }

    const chave = interaction.fields.getTextInputValue('input_pix').trim();
    const nome = interaction.fields.getTextInputValue('input_nome').trim();
    const qrcodeUrl = interaction.fields.getTextInputValue('input_qrcode').trim();

    const erroValidacao = validarCadastroMediador(chave, nome);
    if (erroValidacao) {
      return interaction.reply({ content: `❌ Algo deu errado: ${erroValidacao}`, ephemeral: true });
    }

    // substitui o cadastro antigo pelo novo (apaga o de antes)
    const dados = { chave, nome: nome || null, qrcodeUrl: qrcodeUrl || null };
    MEDIADOR_PIX[interaction.user.id] = dados;
    salvarMediadorPix(MEDIADOR_PIX);

    return interaction.reply({
      content: '✅ Pix atualizado! Sua chave antiga foi substituída por essa nova.',
      embeds: [montarEmbedCadastroMediador(interaction.user, dados)],
      components: [montarBotoesCadastroMediador()].filter(Boolean),
      ephemeral: true,
    });
  }

  // --- Botão "Excluir Pix" -> apaga o cadastro do sistema ---
  if (interaction.isButton() && interaction.customId === 'mediador_excluir_pix') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode usar isso aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }
    if (!MEDIADOR_PIX[interaction.user.id]) {
      return interaction.reply({ content: 'Você não tem nenhuma chave Pix cadastrada.', ephemeral: true });
    }

    delete MEDIADOR_PIX[interaction.user.id];
    salvarMediadorPix(MEDIADOR_PIX);

    return interaction.reply({
      content: '🗑️ Sua chave Pix foi excluída do sistema. Você precisa cadastrar uma nova antes de entrar na fila de novo.',
      ephemeral: true,
    });
  }

  // --- Botão "Verificar Cadastro" ---
  if (interaction.isButton() && interaction.customId === 'mediador_verificar_cadastro') {
    if (!(await membroPodeMediar(interaction.member, interaction.guild))) {
      return interaction.reply({
        content: '🚫 Só CEO ou Mediador pode usar isso aqui. Peça pra um admin configurar o cargo com `!setcargoceo` ou `!setcargomediador` primeiro.',
        ephemeral: true,
      });
    }
    const dados = pegarDadosMediador(interaction.user.id);

    if (!dados) {
      return interaction.reply({
        content: 'Você ainda não cadastrou sua chave PIX. Clique em **Cadastrar Pix** primeiro.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      embeds: [montarEmbedCadastroMediador(interaction.user, dados)],
      components: [montarBotoesCadastroMediador()].filter(Boolean),
      ephemeral: true,
    });
  }

  // --- Botões da fila de mediadores (Entrar / Sair / ⚙️) ---
  if (
    interaction.isButton() &&
    ['fila_mediador_entrar', 'fila_mediador_sair'].includes(interaction.customId)
  ) {
    const idMediador = interaction.user.id;

    if (interaction.customId === 'fila_mediador_entrar') {
      if (filaMediadores.includes(idMediador)) {
        return interaction.reply({ content: 'Você já está na fila de mediadores.', ephemeral: true });
      }

      // só entra quem já cadastrou a chave Pix (o nome é opcional: se não
      // informar, usamos o ID/@ do Discord como identificação)
      const dadosCadastro = pegarDadosMediador(idMediador);
      if (!dadosCadastro || !dadosCadastro.chave) {
        return interaction.reply({
          content: 'Você precisa cadastrar sua chave Pix.',
          ephemeral: true,
        });
      }

      filaMediadores.push(idMediador);
      iniciarSessaoAdm(idMediador);
      return interaction.update({
        embeds: [montarEmbedFilaMediador()],
        components: [montarBotoesFilaMediador()],
      });
    }

    if (interaction.customId === 'fila_mediador_sair') {
      const indice = filaMediadores.indexOf(idMediador);
      if (indice === -1) {
        return interaction.reply({ content: 'Você não está na fila de mediadores.', ephemeral: true });
      }

      filaMediadores.splice(indice, 1);
      encerrarSessaoAdm(idMediador);
      return interaction.update({
        embeds: [montarEmbedFilaMediador()],
        components: [montarBotoesFilaMediador()],
      });
    }
  }

  // --- Botões da fila de suporte (Entrar / Sair) ---
  if (interaction.isButton() && ['fila_suporte_entrar', 'fila_suporte_sair'].includes(interaction.customId)) {
    const idSuporte = interaction.user.id;

    if (interaction.customId === 'fila_suporte_entrar') {
      if (filaSuporte.includes(idSuporte)) {
        return interaction.reply({ content: 'Você já está na fila de suporte.', ephemeral: true });
      }
      if (!(await usuarioPodeSuportar(interaction))) {
        return interaction.reply({ content: 'Você não tem o cargo necessário para entrar nessa fila.', ephemeral: true });
      }
      if (!SUPORTE_PIX[idSuporte]) {
        return interaction.reply({ content: 'Você precisa cadastrar sua chave Pix.', ephemeral: true });
      }

      filaSuporte.push(idSuporte);
      iniciarSessaoSuporte(idSuporte);
      await atualizarPainelSuporteFilaSeExistir();
      return interaction.update({
        embeds: [montarEmbedFilaSuporte()],
        components: [montarBotoesFilaSuporte()],
      });
    }

    if (interaction.customId === 'fila_suporte_sair') {
      const indice = filaSuporte.indexOf(idSuporte);
      if (indice === -1) {
        return interaction.reply({ content: 'Você não está na fila de suporte.', ephemeral: true });
      }

      filaSuporte.splice(indice, 1);
      encerrarSessaoSuporte(idSuporte);
      return interaction.update({
        embeds: [montarEmbedFilaSuporte()],
        components: [montarBotoesFilaSuporte()],
      });
    }
  }

  // --- Botão "Cadastrar Pix" (suporte) ---
  if (interaction.isButton() && interaction.customId === 'suporte_cadastrar_pix') {
    if (SUPORTE_PIX[interaction.user.id]) {
      return interaction.reply({
        content: '⚠️ Você já tem uma chave Pix cadastrada. Use **Verificar Cadastro** pra conferir.',
        ephemeral: true,
      });
    }
    return interaction.showModal(montarModalCadastroSuporte());
  }

  // --- Envio do formulário de cadastro Pix do suporte ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_cadastro_suporte') {
    const chave = interaction.fields.getTextInputValue('input_pix').trim();
    const nome = interaction.fields.getTextInputValue('input_nome').trim();

    if (!chave) {
      return interaction.reply({ content: '❌ Você precisa informar uma chave Pix.', ephemeral: true });
    }

    SUPORTE_PIX[interaction.user.id] = { chave, nome: nome || null };
    salvarSuportePix(SUPORTE_PIX);

    return interaction.reply({
      content: '✅ Cadastro salvo com sucesso!',
      embeds: [montarEmbedPixSuporte(interaction.user.id)],
      ephemeral: true,
    });
  }

  // --- Botão "Verificar Cadastro" (suporte) ---
  if (interaction.isButton() && interaction.customId === 'suporte_verificar_cadastro') {
    if (!SUPORTE_PIX[interaction.user.id]) {
      return interaction.reply({
        content: 'Você ainda não cadastrou sua chave PIX. Clique em **Cadastrar Pix** primeiro.',
        ephemeral: true,
      });
    }
    return interaction.reply({ embeds: [montarEmbedPixSuporte(interaction.user.id)], ephemeral: true });
  }

  // --- Botões de ranking de suporte: Meu Perfil / Ranking ---
  if (interaction.isButton() && ['rankingsuporte_meuperfil', 'rankingsuporte_ver'].includes(interaction.customId)) {
    if (interaction.customId === 'rankingsuporte_meuperfil') {
      return interaction.reply({ embeds: [montarEmbedMeuPerfilSuporte(interaction.user)], ephemeral: true });
    }
    return interaction.reply({
      embeds: [await montarEmbedRankingSuporte(interaction.guild, interaction.user.id)],
      ephemeral: true,
    });
  }

  // --- Select: "Selecione o tipo de atendimento..." (Suporte / Reembolso) ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'atendimento_menu') {
    const opcao = interaction.values[0];

    if (opcao === 'reembolso') {
      return interaction.showModal(montarModalReembolso());
    }

    if (opcao === 'suporte') {
      return interaction.reply({
        content: 'Qual é o seu problema?',
        components: [montarSelectProblemaSuporte()],
        ephemeral: true,
      });
    }
  }

  // --- Envio do formulário de Reembolso -> cria o tópico ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_reembolso') {
    const chave = interaction.fields.getTextInputValue('input_chave_pix').trim();
    const nome = interaction.fields.getTextInputValue('input_nome_completo').trim();
    const valor = interaction.fields.getTextInputValue('input_valor').trim();

    const topico = await interaction.channel.threads
      .create({
        name: `reembolso-${interaction.user.username}`,
        type: ChannelType.PrivateThread,
        reason: 'Ticket de reembolso',
      })
      .catch(() => null);

    if (!topico) {
      return interaction.reply({ content: '⚠️ Não consegui criar o tópico. Confira as permissões do bot.', ephemeral: true });
    }

    await topico.members.add(interaction.user.id).catch(() => {});

    await topico.send({
      content: SUPORTE_ROLE_ID ? `<@&${SUPORTE_ROLE_ID}> <@${interaction.user.id}>` : `<@${interaction.user.id}>`,
      embeds: [montarEmbedTicketReembolso(interaction.user, { chave, nome, valor })],
      components: [montarBotoesTicketReembolso()],
    });

    return interaction.reply({ content: `✅ Ticket criado: ${topico}`, ephemeral: true });
  }

  // --- Select: escolher o problema do suporte -> cria o tópico (ou avisa a fila, se "Outros") ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'suporte_menu_problema') {
    const rotulos = {
      duvida_regras: 'Dúvida sobre as regras',
      problema_pagamento: 'Problema com pagamento',
      erro_bot: 'Erro ou bug no bot',
      denunciar_jogador: 'Denunciar um jogador',
      outros: 'Outros',
    };
    const assunto = rotulos[interaction.values[0]] || 'Outros';

    if (interaction.values[0] === 'outros') {
      const canalAviso = await interaction.client.channels.fetch(CANAL_AVISO_SUPORTE_ID).catch(() => null);
      if (canalAviso) {
        await canalAviso.send({
          content: SUPORTE_ROLE_ID ? `<@&${SUPORTE_ROLE_ID}>` : '',
          embeds: [
            new EmbedBuilder()
              .setColor(COR_AMARELA)
              .setTitle('🔔 Novo atendimento pendente')
              .setDescription(`<@${interaction.user.id}> precisa de suporte e escolheu **Outros**. Entre na fila de suporte pra atender.`),
          ],
        });
      }
      return interaction.update({ content: '✅ Um suporte foi avisado e vai te atender em breve!', components: [] });
    }

    const topico = await interaction.channel.threads
      .create({
        name: `suporte-${interaction.user.username}`,
        type: ChannelType.PrivateThread,
        reason: 'Ticket de suporte',
      })
      .catch(() => null);

    if (!topico) {
      return interaction.update({ content: '⚠️ Não consegui criar o tópico. Confira as permissões do bot.', components: [] });
    }

    await topico.members.add(interaction.user.id).catch(() => {});

    await topico.send({
      content: SUPORTE_ROLE_ID ? `<@&${SUPORTE_ROLE_ID}> <@${interaction.user.id}>` : `<@${interaction.user.id}>`,
      embeds: [montarEmbedTicketSuporte(interaction.user, assunto, '.')],
      components: [montarBotoesTicketSuporte()],
    });

    return interaction.update({ content: `✅ Ticket criado: ${topico}`, components: [] });
  }

  // --- Botão "Informar por Nome" (indicar mediador no ticket de reembolso) ---
  if (interaction.isButton() && interaction.customId === 'ticket_informar_nome') {
    if (!(await usuarioPodeSuportar(interaction))) {
      return interaction.reply({ content: 'Só quem tem o cargo de suporte pode usar essa opção.', ephemeral: true });
    }
    return interaction.showModal(montarModalInformarNome());
  }

  // --- Envio do formulário "Informar por Nome" ---
  if (interaction.isModalSubmit() && interaction.customId === 'modal_informar_nome') {
    const nomeDigitado = interaction.fields.getTextInputValue('input_nome_mediador').trim();
    return interaction.reply({ content: `📌 Mediador indicado: **${nomeDigitado}**` });
  }

  // --- Botão "Resolvido" (fecha ticket de reembolso ou suporte) ---
  if (interaction.isButton() && interaction.customId === 'ticket_resolvido') {
    if (!(await usuarioPodeSuportar(interaction))) {
      return interaction.reply({ content: 'Só quem tem o cargo de suporte pode usar essa opção.', ephemeral: true });
    }

    registrarAtendimentoSuporte(interaction.user.id);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Atendimento finalizado')
          .setDescription('Esse ticket está sendo finalizado.'),
      ],
    });

    await interaction.channel.delete('Ticket resolvido').catch(() => {});
    return;
  }

  // --- Botões de ranking (jogador / adm): Meu Perfil / Ranking ---
  if (
    interaction.isButton() &&
    [
      'ranking_meuperfil',
      'ranking_ver',
      'rankingadm_meuperfil',
      'rankingadm_ver',
    ].includes(interaction.customId)
  ) {
    switch (interaction.customId) {
      case 'ranking_meuperfil':
        return interaction.reply({ embeds: [montarEmbedMeuPerfilJogador(interaction.user)], ephemeral: true });
      case 'ranking_ver':
        return interaction.reply({
          embeds: [await montarEmbedRankingJogadores(interaction.guild, interaction.user.id)],
          ephemeral: true,
        });
      case 'rankingadm_meuperfil':
        return interaction.reply({
          embeds: [montarEmbedMeuPerfilAdm(interaction.user, 'total')],
          components: [montarBotoesMeuPerfilAdm('total')],
          ephemeral: true,
        });
      case 'rankingadm_ver':
        return interaction.reply({
          embeds: [await montarEmbedRankingAdm(interaction.guild, interaction.user.id)],
          ephemeral: true,
        });
    }
  }

  // --- Botões Hoje/3 dias/7 dias do Meu Perfil Adm (edita a mesma msg) ---
  if (interaction.isButton() && ['perfiladm_hoje', 'perfiladm_3dias', 'perfiladm_7dias'].includes(interaction.customId)) {
    const periodo = interaction.customId.replace('perfiladm_', '');
    return interaction.update({
      embeds: [montarEmbedMeuPerfilAdm(interaction.user, periodo)],
      components: [montarBotoesMeuPerfilAdm(periodo)],
    });
  }

  // --- Select: "Finalizar Aposta" (menu abaixo da ficha) ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'ficha_menu_opcoes') {
    const partida = partidas.get(interaction.channelId);
    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });

    if (!(interaction.user.id === partida.mediadorId || (await usuarioPodeMediar(interaction)))) {
      return negarAcessoMediador(interaction);
    }

    if (interaction.values[0] === 'finalizar_aposta') {
      const selectVencedor = await montarSelectEscolherVencedor(interaction.guild, partida);
      // Só quem clicou em Finalizar vê esse passo (e os próximos) —
      // só a última mensagem (partida encerrada) é pública.
      await interaction.reply({
        embeds: [montarEmbedEscolherVencedor()],
        components: [selectVencedor],
        ephemeral: true,
      });
    }
    return;
  }

  // --- Select: escolher o vencedor da partida ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'ficha_escolher_vencedor') {
    const partida = partidas.get(interaction.channelId);
    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });

    if (!(interaction.user.id === partida.mediadorId || (await usuarioPodeMediar(interaction)))) {
      return negarAcessoMediador(interaction);
    }

    partida.vencedorId = interaction.values[0];
    salvarPartidas();

    // já registra a vitória no sistema de ranking assim que o vencedor
    // é escolhido (não precisa esperar o passo de W.O./Vitória normal).
    registrarVitoria(partida.vencedorId);

    // edita a própria mensagem ephemeral (só o mediador continua vendo)
    return interaction.update({
      embeds: [montarEmbedVencedorDefinido(partida)],
      components: [montarSelectTipoVitoria()],
    });
  }

  // --- Select: vencedor por W.O. ou por Vitória -> encerra a partida ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'ficha_tipo_vitoria') {
    const partida = partidas.get(interaction.channelId);
    if (!partida || !partida.vencedorId) {
      return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });
    }

    if (!(interaction.user.id === partida.mediadorId || (await usuarioPodeMediar(interaction)))) {
      return negarAcessoMediador(interaction);
    }

    const porWO = interaction.values[0] === 'wo';

    if (partida.mediadorId) {
      registrarGanhoAdm(partida.mediadorId, ACRESCIMO_MEDIADOR);
    }

    // fecha a mensagem ephemeral (não dá pra excluir ephemeral, só tira
    // os componentes) e manda a última mensagem — essa sim pública,
    // sem nenhuma opção, e o canal já é excluído em seguida.
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.channel.send({ embeds: [montarEmbedPartidaEncerrada(porWO)] });

    // fecha a fila (tópico) na hora, sem esperar
    partidas.delete(interaction.channelId);
    salvarPartidas();
    await interaction.channel.delete('Aposta finalizada').catch((err) => {
      console.error('Erro ao excluir tópico após encerrar partida:', err);
    });

    return;
  }

  // --- Select: escolher o novo valor da partida (botão "Trocar Valor") ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'sala_valor_escolhido') {
    const partida = partidas.get(interaction.channelId);
    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });

    if (!(await usuarioPodeMediar(interaction))) {
      return interaction.update({ content: '🚫 Só admin pode mudar o valor da partida.', embeds: [], components: [] });
    }

    const novoValor = `R$${interaction.values[0]}`;

    if (novoValor === partida.valor) {
      return interaction.update({ content: `Esse já é o valor atual (${novoValor}).`, embeds: [], components: [] });
    }

    partida.valor = novoValor;

    if (partida.salaMessage) {
      await partida.salaMessage.edit({ embeds: [montarEmbedSala(partida)], components: [montarBotoesSala()] }).catch(() => {});
    }

    return interaction.update({ content: `✅ Valor da partida atualizado para **${novoValor}**.`, embeds: [], components: [] });
  }

  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  // --- Botões do painel principal (customId: "fila_<chave>:<painelId>",
  // ex.: "fila_normal:p1", "fila_inf:p1", "fila_emu1:p1", "fila_sair:p1") ---
  const [acaoFila, painelId] = interaction.customId.split(':');
  if (acaoFila && acaoFila.startsWith('fila_') && painelId) {
    const instancia = painelInstancias.get(painelId);
    if (!instancia) {
      return interaction.reply({ content: 'Esse painel não existe mais. Peça pra um admin postar de novo.', ephemeral: true });
    }

    const chaveFila = acaoFila.slice('fila_'.length);

    const removerDeTodasFilas = () => {
      for (const chave of Object.keys(instancia.filas)) {
        instancia.filas[chave] = instancia.filas[chave].filter((id) => id !== userId);
      }
    };

    if (chaveFila === 'sair') {
      removerDeTodasFilas();
      salvarPaineisFila();
      return atualizarPainel(interaction, instancia);
    }

    const filaAlvo = chaveFila;
    if (!instancia.filas[filaAlvo]) return; // customId de uma fila que não existe mais nesse painel

    if (instancia.filas[filaAlvo].includes(userId)) {
      return interaction.reply({ embeds: [embedAvisoBot('Você já está nessa fila.')], ephemeral: true });
    }

    const chaveOposta = Object.keys(instancia.filas).find((k) => k !== filaAlvo && instancia.filas[k].includes(userId));
    if (chaveOposta) {
      const labelOposta = instancia.filasDef.find((f) => f.key === chaveOposta).label;
      return interaction.reply({
        embeds: [embedAvisoBot(`Você já está na fila **${labelOposta}**. Toque em **Sair** primeiro para poder escolher outra opção.`)],
        ephemeral: true,
      });
    }

    if (contarFilasDoUsuario(userId) >= MAX_FILAS_SIMULTANEAS) {
      return interaction.reply({
        embeds: [embedAvisoBot(`Você já está em ${MAX_FILAS_SIMULTANEAS} filas simultâneamente.`)],
        ephemeral: true,
      });
    }

    if (filaMediadores.length === 0) {
      return interaction.reply({
        content: '🚫 Não há mediadores disponíveis no momento. Tente novamente daqui a pouco.',
        ephemeral: true,
      });
    }

    instancia.filas[filaAlvo].push(userId);
    salvarPaineisFila();

    if (instancia.filas[filaAlvo].length >= instancia.capacidade) {
      const jogadores = instancia.filas[filaAlvo].splice(0, instancia.capacidade);
      salvarPaineisFila();

      await interaction.update({
        embeds: [montarEmbedPainel(instancia)],
        components: [montarBotoesPainel(instancia)],
      });

      const nomeFila = instancia.filasDef.find((f) => f.key === filaAlvo).label;
      const numeroFila = gerarNumeroFilaAleatorio();

      try {
        const canalPainel = (await interaction.client.channels.fetch(CANAL_FILAS_ID).catch(() => null)) || interaction.channel;

        const topico = await canalPainel.threads.create({
          name: `aguardando-${numeroFila}`,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: 60,
          reason: `Partida ${instancia.rotuloFormato} ${nomeFila} entre ${jogadores.join(', ')}`,
        });

        for (const jogadorId of jogadores) {
          await topico.members.add(jogadorId);
        }

        const mediadorId = await pegarProximoMediador();
        if (mediadorId) await topico.members.add(mediadorId).catch(() => {});

        const partida = {
          jogadores,
          confirmados: new Set(),
          nomeFila,
          numeroFila,
          rotuloFormato: instancia.rotuloFormato,
          valor: instancia.valor,
          mediadorId,
          vencedorId: null,
          cancelando: false,
          aguardandoPagamento: false,
        };

        await topico.send({
          // "@👁" no lugar do mediador de propósito: quem vai mediar já
          // foi sorteado, mas só é revelado de verdade na ficha, depois
          // que os 2 confirmarem.
          content: `${jogadores.map((id) => `<@${id}>`).join(' ')}${mediadorId ? ' @👁' : ''}`,
          embeds: [montarEmbedConfirmacao(partida)],
          components: [montarBotoesConfirmacao()],
        });

        // aviso de "mudou a forma de mostrar a tela" já na fase de
        // aguardando confirmação — some sozinho quando todo mundo confirmar
        const mensagemTelaAguardando = await topico.send({ embeds: [montarEmbedMudouTela()] }).catch(() => null);
        if (mensagemTelaAguardando) partida.mensagensConfirmacao = [mensagemTelaAguardando];

        partidas.set(topico.id, partida);
        salvarPartidas();
      } catch (err) {
        console.error('Erro ao criar tópico da partida:', err);
        await interaction.channel.send(
          `🎮 **Confronto encontrado (${instancia.rotuloFormato} - ${nomeFila})!** ${jogadores.map((id) => `<@${id}>`).join(' ')}\n⚠️ Não consegui criar o tópico automático — confira as permissões do bot (Criar Tópicos Privados / Gerenciar Tópicos).`
        );
      }

      return;
    }

    return atualizarPainel(interaction, instancia);
  }

  // --- Botões de confirmação (etapa 1, dentro do tópico) ---
  if (interaction.customId === 'partida_confirmar' || interaction.customId === 'partida_cancelar') {
    const threadId = interaction.channelId;
    const partida = partidas.get(threadId);

    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });
    if (!partida.jogadores.includes(userId))
      return interaction.reply({ content: 'Você não faz parte dessa partida.', ephemeral: true });
    if (partida.cancelando) return interaction.reply({ content: 'Essa partida já está sendo cancelada.', ephemeral: true });

    if (interaction.customId === 'partida_confirmar') {
      // Cada pessoa só pode confirmar uma vez — depois de confirmar,
      // clicar de novo não faz nada além de avisar que já confirmou.
      if (partida.confirmados.has(userId)) {
        return interaction.reply({ content: '⚠️ Você já confirmou essa partida. Não dá pra confirmar de novo.', ephemeral: true });
      }

      partida.confirmados.add(userId);
      salvarPartidas();

      if (partida.confirmados.size < partida.jogadores.length) {
        // responde o clique primeiro (atualiza o card na hora, sem
        // esperar a mensagem de aviso ser mandada) — fica mais rápido
        await interaction.update({
          embeds: [montarEmbedConfirmacao(partida)],
          components: [montarBotoesConfirmacao()],
        });

        // avisa todo mundo no tópico quem confirmou e quem ainda falta,
        // no estilo "✅ | Partida Confirmada"
        const faltantes = partida.jogadores.filter((id) => !partida.confirmados.has(id));
        const textoFaltantes =
          faltantes.length > 1
            ? `Os outros jogadores (${faltantes.map((id) => `<@${id}>`).join(', ')}) precisam confirmar para continuar.`
            : `${faltantes.map((id) => `<@${id}>`).join(', ')} precisa confirmar para continuar.`;
        const mensagemAviso = await interaction.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x2ecc71)
                .setAuthor({ name: NOME_ORG })
                .setTitle('✅ | Partida Confirmada')
                .setDescription(`<@${userId}> confirmou a aposta!\n↳ ${textoFaltantes}`),
            ],
          })
          .catch(() => null);

        // guarda a referência (em memória, não salva em arquivo) pra
        // apagar essa mensagem automaticamente quando todos confirmarem
        if (mensagemAviso) {
          if (!partida.mensagensConfirmacao) partida.mensagensConfirmacao = [];
          partida.mensagensConfirmacao.push(mensagemAviso);
        }

        return;
      }

      // todos confirmaram -> apaga as mensagens de aviso de confirmação
      // (já cumpriram o papel delas)
      if (partida.mensagensConfirmacao) {
        for (const msg of partida.mensagensConfirmacao) {
          await msg.delete().catch(() => {});
        }
      }

      // os 2 confirmaram -> apaga a mensagem de confirmação (ela já
      // cumpriu o papel dela; as próximas mensagens — ficha, pix etc —
      // já contam a história sozinhas)
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      // busca o tópico direto da API em vez de confiar só no cache —
      // se "interaction.channel" vier nulo/desatualizado, tudo que vem
      // depois falhava em silêncio sem essa garantia.
      const thread = interaction.channel || (await interaction.client.channels.fetch(interaction.channelId));

      // aguardando-N -> fila-N (mesmo número, só troca o prefixo)
      await thread.setName(`fila-${partida.numeroFila}`).catch(() => {});

      // notificação bonita que se autodestrói em 2 segundos
      const notificacao = await thread.send({ embeds: [montarEmbedNotificacaoBonita(partida)] }).catch((err) => {
        console.error('⚠️ Erro ao mandar a notificação de "Partida Confirmada":', err);
        return null;
      });
      if (notificacao) setTimeout(() => notificacao.delete().catch(() => {}), 2000);

      // o mediador já foi sorteado lá na criação do tópico (partida.mediadorId)

      // ficha da partida com jogadores/mediador/formato/taxa + botões
      await thread
        .send({
          content: partida.mediadorId ? `<@${partida.mediadorId}>` : undefined,
          embeds: [montarEmbedFicha(partida)],
          components: [montarBotoesFicha(), montarSelectFinalizarAposta()],
        })
        .catch((err) => console.error('⚠️ Erro ao mandar a ficha da partida:', err));

      // valor + chave pix
      await thread
        .send({ embeds: [montarEmbedValorPix(partida)] })
        .catch((err) => console.error('⚠️ Erro ao mandar valor/chave Pix:', err));

      // aviso de troca de app de tela, destacado
      await thread
        .send({ embeds: [montarEmbedMudouTela()] })
        .catch((err) => console.error('⚠️ Erro ao mandar aviso de "mudou a tela":', err));

      // card de regras padrão (penúltima mensagem do fluxo — a última é
      // o aviso de "Análises Funcionando", mandado quando a sala é criada)
      await thread
        .send({ embeds: [montarEmbedRegrasPadrao()] })
        .catch((err) => console.error('⚠️ Erro ao mandar card de regras padrão:', err));

      return;
    }

    if (interaction.customId === 'partida_cancelar') {
      await interaction.update({
        embeds: [montarEmbedConfirmacao(partida)],
        components: [],
      });
      return executarCancelamento(interaction.channel, partida);
    }
  }

  // --- Botões da sala (ID/Senha) ---
  if (interaction.customId === 'sala_copiar_id' || interaction.customId === 'sala_trocar_valor') {
    const partida = partidas.get(interaction.channelId);
    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });

    if (interaction.customId === 'sala_copiar_id') {
      return interaction.reply({ content: `${partida.salaId}`, ephemeral: true });
    }

    if (interaction.customId === 'sala_trocar_valor') {
      if (!(await usuarioPodeMediar(interaction))) {
        return interaction.reply({ content: '🚫 Só admin pode mudar o valor da partida.', ephemeral: true });
      }
      return interaction.reply({ content: 'Escolha o novo valor:', components: [montarSelectTrocarValor()], ephemeral: true });
    }
  }

  // --- Botões da ficha da partida (etapa 2) ---
  if (interaction.customId === 'ficha_qr' || interaction.customId === 'ficha_cancelar') {
    const threadId = interaction.channelId;
    const partida = partidas.get(threadId);

    if (!partida) return interaction.reply({ content: 'Essa partida não está mais ativa.', ephemeral: true });

    if (interaction.customId === 'ficha_qr') {
      const dados = pegarDadosMediador(partida.mediadorId);
      const chave = pegarChavePix(partida.mediadorId);
      const tipo = detectarTipoChavePix(chave);

      try {
        // se o mediador cadastrou um QR code próprio, usa ele
        if (dados && dados.qrcodeUrl) {
          const embedQr = new EmbedBuilder()
            .setColor(COR_DOURADA)
            .setTitle('Chave PIX')
            .addFields({ name: 'Chave:', value: `\`${chave}\`` }, { name: 'Tipo:', value: tipo })
            .setImage(dados.qrcodeUrl);

          return interaction.reply({ embeds: [embedQr], ephemeral: true });
        }

        // senão, gera automaticamente a partir da chave, com o emoji
        // das abelhas no meio do QR code
        const bufferQr = await gerarQrComLogo(chave);
        const anexo = new AttachmentBuilder(bufferQr, { name: 'pix-qrcode.png' });
        const embedQr = new EmbedBuilder()
          .setColor(COR_DOURADA)
          .setTitle('Chave PIX')
          .addFields({ name: 'Chave:', value: `\`${chave}\`` }, { name: 'Tipo:', value: tipo })
          .setImage('attachment://pix-qrcode.png');

        return interaction.reply({ embeds: [embedQr], files: [anexo], ephemeral: true });
      } catch (err) {
        console.error('Erro ao gerar QR code:', err);
        return interaction.reply({ content: 'Não consegui gerar o QR code agora, tente de novo.', ephemeral: true });
      }
    }

    if (interaction.customId === 'ficha_cancelar') {
      if (!(interaction.user.id === partida.mediadorId || (await usuarioPodeMediar(interaction)))) {
        return negarAcessoMediador(interaction);
      }
      if (partida.cancelando) return interaction.reply({ content: 'Essa partida já está sendo cancelada.', ephemeral: true });

      await interaction.reply({ content: '❌ Cancelando a partida...', ephemeral: true });
      return executarCancelamento(interaction.channel, partida);
    }
  }
 } catch (err) {
  // Sem isso, qualquer erro em qualquer botão/formulário fazia o
  // Discord mostrar só "Algo deu errado, tente novamente" sem
  // ninguém saber o motivo. Agora sempre loga o erro real e sempre
  // avisa a pessoa, em vez de deixar a interação sem resposta.
  console.error('⚠️ Erro não tratado numa interação (botão/select/modal):', err);
  try {
    const mensagemErro = { content: '⚠️ Deu um erro inesperado. Tenta de novo, e se continuar, avisa um admin.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(mensagemErro);
    } else {
      await interaction.reply(mensagemErro);
    }
  } catch (err2) {
    console.error('⚠️ Nem consegui avisar a pessoa sobre o erro:', err2);
  }
 }
});

// Tira a pessoa de todas as filas de staff (mediador/suporte)
// que ela estiver, exatamente como se tivesse clicado em "Sair" —
// usado tanto quando fica offline quanto quando sai do servidor.
async function removerDeTodasFilasDeStaff(userId) {
  const indiceMediador = filaMediadores.indexOf(userId);
  if (indiceMediador !== -1) {
    filaMediadores.splice(indiceMediador, 1);
    encerrarSessaoAdm(userId);
    await atualizarPainelMediadorSeExistir();
  }

  const indiceSuporte = filaSuporte.indexOf(userId);
  if (indiceSuporte !== -1) {
    filaSuporte.splice(indiceSuporte, 1);
    encerrarSessaoSuporte(userId);
    await atualizarPainelSuporteFilaSeExistir();
  }
}

// Se alguém que está em alguma fila de staff fica offline (fecha o
// Discord), sai da fila automaticamente — só volta quando entrar de
// novo pelo painel. Só reage à transição PRA offline (não mexe em
// away/ocupado).
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.userId) return;
  if (newPresence.status !== 'offline') return;

  await removerDeTodasFilasDeStaff(newPresence.userId);
});

// Se alguém que está em alguma fila de staff sai do servidor, sai da
// fila automaticamente também (mesmo efeito de clicar em "Sair").
client.on('guildMemberRemove', async (member) => {
  await removerDeTodasFilasDeStaff(member.id);
});

// Dá o cargo "Membro" automaticamente pra quem entra no servidor.
client.on('guildMemberAdd', async (member) => {
  if (!MEMBRO_ROLE_ID) return;
  await member.roles.add(MEMBRO_ROLE_ID).catch((err) => {
    console.error('⚠️ Não consegui dar o cargo de Membro automático:', err.message);
  });
});

client.once('ready', async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  await garantirEmojisPersonalizados();
});

// Sem isso, um erro pequeno em qualquer parte do código (uma chamada
// à API do Discord que falha, por exemplo) podia derrubar o processo
// inteiro sem aviso — a hospedagem reinicia sozinha, e o que estava
// só na memória (como painéis recém-criados) se perde antes de salvar
// em disco. Com isso, o bot só registra o erro no console e continua
// rodando normalmente.
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Erro não tratado (unhandledRejection):', err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Erro não tratado (uncaughtException):', err);
});

client.login(TOKEN);
