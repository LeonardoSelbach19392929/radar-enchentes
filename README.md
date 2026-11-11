# Radar de Enchentes RS

Site para acompanhar o nível dos rios no Rio Grande do Sul. A busca encontra as estações por cidade, e o gráfico mostra como o nível mudou ao longo do tempo. Os dados vêm da Defesa Civil RS.

## Rodar no VS Code

1. Extraia o ZIP e abra a pasta `radar-enchentes-rs` no VS Code.
2. Com o **Node.js 22 ou superior** instalado, abra o terminal integrado e execute:

   ```bash
   node server.js
   ```

3. Acesse [http://127.0.0.1:5500](http://127.0.0.1:5500) no navegador e mantenha o terminal aberto.

O Node.js já traz tudo o que o projeto precisa. Depois de iniciar o servidor, abra o endereço do passo 3.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | Estrutura do painel |
| `style.css` | Layout responsivo e estilos |
| `script.js` | Pesquisa, atualização automática e gráfico |
| `server.js` | Servidor local que consulta a Defesa Civil RS |
| `consultas.json` | Consultas GraphQL no formato exigido pela API |

## Dados do painel

- A busca aceita o nome da cidade com ou sem acentos. A cobertura depende da rede estadual.
- O nível é exibido em metros e o horário da leitura está no fuso de Brasília.
- A tendência compara a leitura atual à média da última hora, conforme o indicador da fonte.
- A situação de inundação vem da classificação da própria estação. A disponibilidade depende da cota de referência, da qualidade e da atualidade da leitura.
- O gráfico usa blocos de 10 minutos para os períodos de 6 e 24 horas e blocos de 3 horas para 7 dias. As lacunas indicam ausência de medições.
- A consulta automática segue o ciclo da rede, de cerca de 5 minutos. O horário de consulta pode ser mais recente que a medição.

[Documentação da API](https://sistemas.defesacivil.rs.gov.br/api-redehidrometeorologica) · [Defesa Civil RS](https://www.defesacivil.rs.gov.br/)
