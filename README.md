# layer-aware-pointer-events

A dependency-free toolkit for addressing issues in enacting `MouseEvent`
propagation across stacked layers of sibling `Element` objects involving
Shadow DOMs.

## Install

`npm install @semolina-solutions/layer-aware-pointer-events`

## Usage

For a structure like:

```html
<html>
  <head>
    <style>
      #container {
        position: relative;
      }
      #container > * {
        position: absolute;
      }
    </style>
  </head>
  <body>
    <div id="container">
      <my-web-component id="background"> </my-web-component>
      <my-web-component id="foreground"> </my-web-component>
    </div>
  </body>
</html>
```

Where `<my-web-component>` has an attached Shadow DOM with inner elements, we
can ensure elements within both `#foreground` and `#background` receive
`click` events, and through Shadow DOM boundaries, using the following
handler attachment:

```javascript
import { dispatchToUnderlyingElements } from '@semolina-solutions/layer-aware-pointer-events'

const element = document.querySelector('#container')
element.addEventListener('click', dispatchToUnderlyingElements)
```
