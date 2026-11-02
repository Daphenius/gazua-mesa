# Changelog

## v1.6.2
- **Teste pelo Dados em Cena**: quando a rolagem chega, o mestre confere de novo se o personagem ainda é do jogador e ainda está ao alcance da fechadura. Quem se afastou durante a rolagem não abre a porta, não registra falha, não quebra gazua e não fica liberado para o minijogo.
- 5 testes novos para esse caso (55 no total).

## v1.6.1
Correções de uma revisão externa (obrigado!):
- **Pedidos ao mesmo tempo**: o mestre agora trata um pedido de cada vez, relendo a fechadura e o inventário antes de gastar qualquer coisa. Dois cliques juntos não gastam duas chaves nem abrem a porta duas vezes; duas falhas juntas não passam do limite de tentativas nem quebram gazua a mais. A espera pela rolagem do Dados em Cena não trava os outros pedidos, e a decisão relê a fechadura quando a rolagem chega. Na janela do jogador, a chave também não aceita clique repetido.
- **Minijogos de outra abertura**: quando a fechadura é destrancada (por chave, teste, minijogo ou pelo mestre), os minijogos em andamento nela acabam, sem falha. Trancar de novo não traz de volta a falha de uma tentativa antiga.
- **Chave mestra empilhada**: ao gastar uma unidade, a próxima da pilha começa com os usos cheios (duas chaves de 2 usos = 4 aberturas).
- **Quantidade zero**: gazua ou chave com quantidade 0 não serve mais, nem na janela nem na conferência do mestre.
- **Modo da fechadura**: o mestre confere se a forma pedida é permitida. Numa fechadura só de minijogo, o teste simples não destranca; com "passar na CD antes", a falha nesse teste ainda conta.
- 12 testes novos cobrindo esses casos (50 no total).

## v1.6.0
- **O mestre decide o minijogo**: o computador do mestre escolhe o jogo e sorteia a "semente" que monta o desafio; o jogador joga a partir dela e manda as jogadas; o mestre monta o mesmo desafio, refaz as jogadas e decide se abriu. Antes, quem dizia "abri" era o computador do jogador.
- O "teste antes" do minijogo agora é conferido no começo do jogo, e o tempo extra pela margem na CD é calculado pelo mestre.
- A sessão do minijogo fica guardada na fechadura: fechar a janela conta como desistência; se a janela não abrir por erro, a próxima tentativa retoma o mesmo desafio; um jogo largado aberto por mais de 5 minutos (ou além do tempo limite) conta como falha.
- No Selo rúnico, os toques só valem depois de o selo mostrar a sequência.
- **Ferramentas de Ladrão** são reconhecidas pelo tipo base do D&D 5e; o nome do item só vale para ferramentas sem tipo base.
- Botão **Salvar** dos ajustes dos minijogos, número do relógio e contador do Sigilo ganharam o estilo que faltava.
- **Só Foundry 14**: saiu o código de compatibilidade com versões antigas (jQuery no HUD do token, controles antigos da cena, TextEditor antigo, diálogos antigos, tipos de item antigos e a API do antigo Epic Roll da Mesa; agora só o Dados em Cena).
- Por dentro: as regras dos 6 minijogos foram separadas da tela (novo arquivo `scripts/logica.js`, sem nada do Foundry), o que também acabou com a gambiarra da resistência do Fio de mana; a lista e os ícones dos minijogos ficam num lugar só; imports carregados direto, sem carregamento tardio.
- **Testes automáticos** (`npm test`): conferências do mestre (remetente, dono do personagem, alcance, tentativas, modo só chave), fechaduras trancadas em porta, baú e diário, desgaste da gazua e o sorteio dos 6 minijogos. A release no GitHub só sai se eles passarem.

## v1.5.2
- **Quem decide é o mestre**: o resultado do teste de Ferramentas de Ladrão agora é conferido no mestre, pela rolagem que aparece no chat (ou pelo Dados em Cena), e não mais pelo que o jogador manda. Cada rolagem vale para uma tentativa só. O mestre também confere se o personagem é mesmo do jogador que pediu, se está ao alcance da fechadura, se ainda tem tentativas e se tem gazua quando a fechadura exige.
- O resultado do minijogo ainda vem do jogador (fica para uma versão futura); mas agora o mestre exige a rolagem do "teste antes", quando ela está ligada.
- Entrar numa região trancada: a fechadura passa a usar o destino do movimento do token, e não a posição no meio da animação.
- Ao salvar a fechadura, o estado trancado/destrancado é gravado de uma vez, sem passar por um estado errado no meio.
- O campo **Gazuas** só mexe nos usos de itens que já têm usos; nos outros, usa a quantidade.
- Arrumações internas: avisos pelo socket validados, código morto removido, estilo duplicado do relógio dos minijogos unificado, novo formato do pacote da release.

## v1.5.1
- **Gazuas na coluna "Usos" da ficha**: o campo **Gazuas** da configuração agora grava nos usos do item (ex.: 20/20). Cada gazua que quebra gasta um uso (19/20…). Acabando os usos, o item sai do inventário; se o item tiver mais de uma unidade, abre a próxima com os usos cheios. Itens sem usos (como "loot") continuam contando pela quantidade. A **Nova gazua** do painel já vem com 20 usos.
- Gazua com os usos esgotados deixa de contar para arrombar.
- **Aviso de token não vinculado**: quando uma gazua ou chave é dada ao token de um personagem de jogador que não está vinculado à ficha, o mestre recebe um aviso. Itens assim ficam só naquele token e somem da ficha do personagem (por exemplo, quando o jogador entra de novo).

## v1.5.0
- **Aviso do libWrapper resolvido de vez**: a Gazua não mexe mais em nenhuma função do Foundry, nem pelo libWrapper. Ela só "ouve" o clique no ícone da porta, então nunca mais entra no aviso de conflito com o Arm's Reach ou o Objetos Vivos. O libWrapper deixou de ser recomendado.
- **Quantidade de gazuas**: a configuração da gazua ganhou o campo **Quantidade** (ex.: 20). O item fica empilhado na ficha, como qualquer item com quantidade, e cada gazua que quebra tira uma. A **Nova gazua** do painel já vem com 20.
- Saiu a divisão automática em pilhas da v1.4.0 (e a opção "Gazuas por pilha"): a quantidade fica num item só, como na ficha nativa.

## v1.4.1
- Corrigido de vez o aviso do libWrapper sobre conflito com o Arm's Reach e o Objetos Vivos. A Gazua agora só "escuta" o clique na porta (tipo ouvinte do libWrapper) e não impede mais o Foundry nem outros módulos de reagirem ao clique. A janela da fechadura continua abrindo igual, e o Foundry toca o som de porta trancada.

## v1.4.0
- **Pilhas de gazua**: cada pilha do inventário guarda no máximo 20 gazuas (opção **Gazuas por pilha**; 0 = sem limite). Passou disso, o excedente vira uma nova pilha (45 gazuas = 20 + 20 + 5), tanto ao receber o item quanto ao aumentar a quantidade. Cada gazua pode ter o próprio limite ("Máximo por pilha" na configuração do item).

## v1.3.1
- Corrigido o aviso do libWrapper ("Gazua da Mesa e Arms Reach modificam a mesma funcionalidade"). Com o libWrapper ativo, o clique em portas passa a ser registrado por ele, e os dois módulos convivem. Sem o libWrapper, funciona como antes.
- libWrapper entrou como módulo recomendado.

## v1.3.0
- **Gazua equipada**: para arrombar, a gazua precisa estar equipada na ficha (opção nas configurações, ligada por padrão). Se o personagem tiver uma gazua guardada, a janela avisa para equipar.
- **Teste pelo Dados em Cena**: com o módulo Dados em Cena ativo, o teste de Ferramentas de Ladrão é pedido na tela animada ou na tela simples (card no chat), conforme a opção do módulo. A tela animada abre só para o jogador e o mestre. Sem o Dados em Cena, o teste é rolado pela ficha, como antes.
- **Configurar minijogos**: nova tela (Configurações do módulo, ou o painel do mestre) com os ajustes de cada minijogo: entra ou não no sorteio da Surpresa, tempo próprio, ajuste de dificuldade, concentração extra e opções do jogo (máximo de anéis, anéis presos por magia, ordem inversa, velocidade, tamanho da trama, rastro, dica de onde começar, tamanho da grade, velocidade e largura da faixa). Cada um tem um botão **Testar agora**.
- **A gazua quebra na falha**: cada falha tira uma unidade do inventário (20 gazuas viram 19) e o chat avisa. Nova opção **Quando a gazua quebra**: nos testes e nos minijogos (padrão), só nos testes, só nos minijogos ou nunca. Uma gazua marcada pelo mestre pode aguentar mais de uma falha por unidade ("Falhas até quebrar").
- A janela do jogador mostra o resultado do teste (passou ou não) e ganhou um "Como abrir com a gazua".
- Se um minijogo não conseguir abrir, aparece um aviso com o erro no console, em vez de a janela ficar presa.

## v1.2.1
- Na lista de chaves da configuração da fechadura, cada item ganhou dois botões: **deixar de abrir esta fechadura** (o item continua existindo e, se não sobrar nenhum segredo, volta a ser um item comum) e **excluir o item** (pede confirmação).

## v1.2.0
- Saiu o minijogo de pinos. No lugar, seis minijogos próprios do módulo, todos com tema rúnico e mágico (a fechadura tem uma proteção arcana que a gazua precisa desfazer):
  - **Anéis rúnicos**: gire os anéis até a runa brilhante de cada um ficar sob o sigilo; alguns anéis estão presos por magia e arrastam o vizinho junto.
  - **Selo rúnico**: o selo acende uma sequência de runas e o jogador repete (em níveis altos, ao contrário).
  - **Fio de mana**: conduza uma centelha pelas linhas invisíveis da proteção até o núcleo; cada choque revela uma barreira e abala a concentração.
  - **Sigilo de traço**: trace todas as linhas do sigilo, de runa em runa, sem passar duas vezes pela mesma.
  - **Cristais em harmonia**: tocar um cristal acende ou apaga ele e os vizinhos; deixe todos acesos ao mesmo tempo.
  - **Canalizar**: segure para erguer a mana e mantenha-a dentro da faixa rúnica, que se move, até encher o selo.
  - Ou **Surpresa**, que sorteia um a cada tentativa.
- **Tempo limite** nos minijogos, definido em cada fechadura.
- **Passar na CD para usar a gazua**: antes do minijogo, o personagem rola Ferramentas de Ladrão; quem falha não chega a jogar e cada ponto acima da CD vira tempo extra.
- **Gazua escolhida pelo mestre**: qualquer item pode virar gazua, com bônus e um limite de falhas antes de quebrar. Uma opção decide se Ferramentas de Ladrão também contam.
- **Qualquer item vira chave**: arraste um item (da aba de Itens ou do inventário) para a configuração da fechadura. A tela mostra quais itens já abrem aquela fechadura.
- Personagens com bônus alto enfrentam uma versão mais fácil do minijogo.

## v1.1.0
- Interface nova, mais moderna e fácil de entender: cartões, interruptores e seções na configuração da fechadura e da chave; janela do jogador redesenhada.
- Agora dá para escolher, em cada fechadura, como ela abre sem a chave: **Só a chave**, **Gazua simples** (um teste de Ferramentas de Ladrão), **Gazua com minigame** ou **O jogador escolhe**.
- Minigame novo: a fechadura aparece em corte, com pinos, molas e a linha de corte. O jogador acha o pino que trava, levanta até a linha e solta no ponto certo, um pino por vez, até o cilindro girar.
- A dificuldade virou um controle deslizante que mostra quantos pinos o minigame terá.
- Corrigido: o arquivo de estilo não era carregado na v1.0.0.

## v1.0.0
- Primeira versão, **em testes**: ainda não está completa e pode ter muitos erros e vícios de IA.
- Fechaduras em portas, tokens (baús), tiles, regiões (portais), notas, diários e páginas.
- Chaves com segredos (uma chave para várias fechaduras e várias chaves para uma fechadura).
- Chave mestra limitada por nível e/ou por usos; chaves comuns são gastas ao abrir.
- Arrombar por teste de ferramentas de ladrão (D&D 5e) ou pelo minigame da gazua.
- Efeitos ao destrancar: abrir porta, mostrar/esconder, permissões, revelar diário, macro e mensagem.
- Integração com Item Piles e com os portais/gatilhos do Navegador de Mapas.
- Painel do mestre, botão no HUD do token, português e inglês.
