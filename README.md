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
- **Como abrir sem a chave**: **Só a chave**, **Gazua simples** (um teste de Ferramentas de Ladrão contra a CD), **Gazua com minijogo** ou **O jogador escolhe**. Também dá para definir a CD, exigir uma gazua, limitar tentativas por personagem e o alcance.
- **Minijogo**: qual jogo (ou Surpresa), tempo limite e se é preciso passar na CD antes de jogar.
- **Ao destrancar**: abrir a porta, mostrar/esconder o objeto, dar permissão no baú ou diário, revelar outro diário, executar uma macro e mandar uma mensagem no chat.

O botão **Criar uma chave para esta fechadura** já cria o item na aba de Itens com o segredo certo. Ou arraste **qualquer item** (da aba de Itens ou do inventário de um personagem) para a área indicada na configuração, e ele vira a chave dessa fechadura. A tela mostra quais itens já a abrem; em cada um dá para tirar o vínculo com a fechadura ou excluir o item.

### Chaves e gazuas
Qualquer item vira chave ou gazua: menu do cabeçalho da ficha (ou clique direito na aba de Itens) → **Chave / gazua (Gazua da Mesa)**.
- **Chave comum**: some do inventário quando abre a fechadura (se houver várias, gasta uma).
- **Chave mestra**: não é gasta e abre fechaduras mesmo sem o segredo, **até um nível** (0 = qualquer) e/ou **por um número de usos** (depois se desgasta e some). Uma fechadura pode recusar chaves mestras.
- **Gazua**: serve para arrombar e precisa estar **equipada**. Pode ter **bônus** (soma no teste e dá tempo extra no minijogo) e quantas **falhas até quebrar** cada unidade aguenta (1 = quebra na primeira). Nas configurações do módulo você decide se Ferramentas de Ladrão também contam como gazua.

**A gazua quebra quando o personagem falha**: sai uma unidade do inventário (quem tem 20 gazuas fica com 19) e o chat avisa. A opção **Quando a gazua quebra** escolhe em quais falhas isso acontece: nos testes e nos minijogos, só nos testes, só nos minijogos ou nunca. Com o teste antes do minijogo ligado, o jogador precisa passar duas vezes (no teste e no minijogo) e pode perder uma gazua em cada falha.

### Como o jogador abre com a gazua
1. Tenha uma gazua **equipada** na ficha (Inventário → equipar). Pode ser Ferramentas de Ladrão ou qualquer item que o mestre marcou como gazua.
2. Fique ao lado da fechadura com o token selecionado e clique na porta (ou no botão de chave do HUD do token).
3. Escolha **Gazua simples** (um teste de Ferramentas de Ladrão contra a CD) ou **Gazua com minijogo**.
4. No minijogo, se o mestre ligou "Passar na CD para usar a gazua", o teste vem primeiro; passando, o minijogo abre com o tempo limite (mais 2 s por ponto acima da CD).

Com o módulo **Dados em Cena** ativo, o teste de Ferramentas de Ladrão é pedido por ele, na tela animada ou na tela simples (card no chat), conforme a opção "Teste de Ferramentas de Ladrão pelo Dados em Cena".

### Para os jogadores
- **Clicar numa porta trancada** abre a janela da fechadura.
- **Entrar numa região trancada** (um portal, por exemplo) abre a janela.
- **Botão de chave no HUD do token** lista as fechaduras ao alcance (e os diários que alguma chave do personagem abre).

Na janela, o jogador experimenta qualquer chave que carrega ou tenta arrombar.

### Minijogos
As fechaduras são guardadas por uma proteção arcana que a gazua precisa desfazer. Cada fechadura escolhe um minijogo (ou **Surpresa**, que sorteia) e um **tempo limite**:
- **Anéis rúnicos**: gire os anéis até a runa brilhante de cada um ficar sob o sigilo. Alguns anéis estão presos por magia e arrastam o vizinho junto.
- **Selo rúnico**: o selo acende uma sequência de runas; toque-as na mesma ordem. Em níveis altos, ao contrário.
- **Fio de mana**: conduza uma centelha pelas linhas invisíveis da proteção até o núcleo. Cada choque revela uma barreira e abala a concentração.
- **Sigilo de traço**: trace todas as linhas do sigilo, de runa em runa, sem passar duas vezes pela mesma.
- **Cristais em harmonia**: tocar um cristal acende ou apaga ele e os vizinhos; deixe todos acesos ao mesmo tempo.
- **Canalizar**: segure para erguer a mana e mantenha-a dentro da faixa rúnica, que se move, até encher o selo.

Com **Passar na CD para usar a gazua** ligado, o personagem rola Ferramentas de Ladrão antes: quem falha não chega a jogar, e cada ponto acima da CD dá +2 segundos. O nível da fechadura define a dificuldade, que fica mais fácil para quem tem bônus alto. Cada janela tem um "Como jogar".

Em **Configurações do módulo → Configurar minijogos** (ou no painel do mestre), cada minijogo tem seus ajustes: se entra no sorteio da Surpresa, tempo próprio, ajuste de dificuldade, concentração extra e opções próprias. O botão **Testar agora** abre o jogo na hora.

### Integrações
- **Item Piles**: baús do Item Piles trancam e destrancam junto.
- **Navegador de Mapas**: região trancada desliga os comportamentos dela (portais e gatilhos) até ser destrancada; objetos com gatilho podem ter o gatilho desativado enquanto trancados.
- **Painel do mestre**: no controle de tokens, botão de chave com todas as fechaduras da cena e as chaves da aba de Itens (trancar/destrancar, ir até, testar como jogador).

### API para macros
`game.modules.get("gazua-mesa").api` traz `abrir`, `proximas`, `configurar`, `configurarChave`, `remover`, `painel`, `destrancar`, `trancar`. Os hooks `gazua-mesa.destrancou` e `gazua-mesa.trancou` disparam no mestre.

## Licença
MIT.
