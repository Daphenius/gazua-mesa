# Gazua da Mesa (Em testes)

## Sobre como este módulo foi feito

Sei que parte da comunidade não gosta de módulos produzidos com IA, então prefiro ser transparente: este foi desenvolvido com ajuda de IA. Não sou programador.

Tudo começou quando um amigo me disse: “cara, ficou muito mais simples, é só fazer uma macro do que você quer”. Fiz a macro para a minha mesa, fui adaptando conforme a necessidade dos jogos e, no fim, ela virou um módulo. Uso nas minhas próprias sessões e resolvi compartilhar caso seja útil para mais alguém.

Se encontrar bugs ou tiver sugestões, abra uma issue. Todo retorno é bem-vindo.

> ⚠️ **Em testes.** Este módulo ainda não está completo e pode ter muitos erros e vícios de IA. Use com cuidado e, de preferência, num mundo de teste ou com backup.

---

Fechaduras e chaves para o Foundry VTT. Tranque portas, baús, tiles, regiões (inclusive portais) e diários; esconda o "segredo" de cada fechadura em itens que os jogadores encontram pela aventura; e deixe quem não tem a chave tentar a sorte com ferramentas de ladrão ou com o minigame da gazua.

**Testado no Foundry VTT 14 com o sistema D&D 5e.** O mestre testa cada versão na própria mesa logo que ela sai.

## Instalação

No Foundry, em **Módulos complementares → Instalar módulo**, cole este link do manifesto:

```
https://github.com/Daphenius/gazua-mesa/releases/latest/download/module.json
```

Requer Foundry VTT 14.

## Como funciona

### Fechaduras
Abra a configuração de uma **porta, token, tile, região, nota do mapa, diário ou página** e, no menu do cabeçalho (os três pontinhos), escolha **Fechadura (Gazua da Mesa)**. Nos diários, também dá pelo clique direito na barra lateral.

Cada fechadura tem:
- **Nível (1–10)**: deixa o minigame mais difícil e limita quais chaves mestras abrem.
- **Segredos**: palavras-código. Qualquer chave com um desses segredos abre a fechadura. O mesmo segredo em várias fechaduras faz uma chave abrir todas; vários segredos numa fechadura fazem várias chaves servirem.
- **Sem a chave**: teste de ferramentas de ladrão, minigame da gazua, os dois (o jogador escolhe) ou só com a chave. CD, exigência de ferramentas, tentativas por personagem e alcance.
- **Ao destrancar**: abrir a porta, mostrar/esconder o objeto, dar permissão no baú ou diário, revelar outro diário, executar uma macro e mandar uma mensagem no chat.

O botão **Criar uma chave para esta fechadura** já cria o item na aba de Itens com o segredo certo.

### Chaves
Qualquer item vira chave: menu do cabeçalho da ficha (ou clique direito na aba de Itens) → **Chave (Gazua da Mesa)**.
- **Chave comum**: some do inventário quando abre a fechadura (se houver várias, gasta uma).
- **Chave mestra**: não é gasta e abre fechaduras mesmo sem o segredo, **até um nível** (0 = qualquer) e/ou **por um número de usos** (depois se desgasta e some). Uma fechadura pode recusar chaves mestras.

### Para os jogadores
- **Clicar numa porta trancada** abre a janela da fechadura.
- **Entrar numa região trancada** (um portal, por exemplo) abre a janela.
- **Botão de chave no HUD do token** lista as fechaduras ao alcance (e os diários que alguma chave do personagem abre).

Na janela, o jogador experimenta qualquer chave que carrega ou tenta arrombar.

### Minigame da gazua
Uma agulha corre pela barra; aperte **Espaço** quando ela passar no verde para levantar cada pino. Errar desgasta a gazua. O tamanho da área verde depende da CD comparada ao bônus do personagem (Destreza + proficiência em ferramentas de ladrão); o nível da fechadura define quantos pinos e a velocidade. Expertise dá uma gazua extra.

### Integrações
- **Item Piles**: baús do Item Piles trancam e destrancam junto.
- **Navegador de Mapas**: região trancada desliga os comportamentos dela (portais e gatilhos) até ser destrancada; objetos com gatilho podem ter o gatilho desativado enquanto trancados.
- **Painel do mestre**: no controle de tokens, botão de chave com todas as fechaduras da cena e as chaves da aba de Itens (trancar/destrancar, ir até, testar como jogador).

### API para macros
`game.modules.get("gazua-mesa").api` traz `abrir`, `proximas`, `configurar`, `configurarChave`, `remover`, `painel`, `destrancar`, `trancar`. Os hooks `gazua-mesa.destrancou` e `gazua-mesa.trancou` disparam no mestre.

## Licença
MIT.
