import template from 'babel-template';

const buildTemplate = template(`const __steps = [];
let __callCount = 0;

function __trace(step) {
  if (step.incrementCallCount) {
    __callCount++;
  }

  __steps.push({
    callCount: __callCount,
    ...step,
  });
}

ALGORITHM_BODY

module.exports = function (...args) {
  const returnValue = ALGORITHM_NAME(...args);
  return {
    steps: __steps,
    returnValue: returnValue,
    code: ALGORITHM_CODE,
  };
}`, {
  plugins: ['objectRestSpread']
});

export default function ({ types: t }) {
  function isNewlyCreatedPath(path) {
    return !path.node.loc;
  }

  function getPathLine(path) {
    return path.node.loc.start.line;
  }

  function createTraceCall({
    line,
    context,
    incrementCallCount,
    returnValue,
  }) {
    const args = [
      t.objectProperty(t.identifier('line'), t.numericLiteral(line)),
      t.objectProperty(t.identifier('context'), t.objectExpression(context.map(name =>
        t.objectProperty(t.identifier(name), t.identifier(name))
      ))),
    ];
    if (incrementCallCount) {
      args.push(
        t.objectProperty(t.identifier('incrementCallCount'), t.booleanLiteral(true)),
      );
    }
    if (returnValue) {
      args.push(
        t.objectProperty(t.identifier('returnValue'), returnValue),
      );
    }

    return t.callExpression(t.identifier('__trace'), [
      t.objectExpression(args)
    ]);
  }

  const innerVisitor = {
    VariableDeclaration(path) {
      if (isNewlyCreatedPath(path)) {
        return;
      }

      this.bindings.push(
        ...path.node.declarations.map(d => d.id.name)
          .filter(d => this.bindings.indexOf(d) === -1)
      );

      path.insertAfter(createTraceCall({
        line: getPathLine(path),
        context: this.bindings,
      }));
    },
    AssignmentExpression(path) {
      if (isNewlyCreatedPath(path)) {
        return;
      }

      path.insertAfter(createTraceCall({
        line: getPathLine(path),
        context: this.bindings,
      }));
    },
    ReturnStatement(path) {
      if (isNewlyCreatedPath(path)) {
        return;
      }

      const returnValId = path.scope.generateUidIdentifier('uid');
      path.replaceWithMultiple([
        t.variableDeclaration('const', [
          t.variableDeclarator(returnValId, path.node.argument)
        ]),
        createTraceCall({
          line: getPathLine(path),
          context: this.bindings,
          returnValue: returnValId,
        }),
        t.returnStatement(returnValId)
      ]);
    },
    'WhileStatement|IfStatement'(path) {
      if (isNewlyCreatedPath(path)) {
        return;
      }

      const testPath = path.get('test');
      testPath.replaceWith(
        t.logicalExpression('||', createTraceCall({
          line: getPathLine(testPath),
          context: this.bindings,
        }), testPath.node)
      );
    }
  };

  return {
    visitor: {
      ExportDefaultDeclaration(path) {
        const fnPath = path.get('declaration');

        path.replaceWithMultiple(
          buildTemplate({
            ALGORITHM_NAME: t.identifier(fnPath.node.id.name),
            ALGORITHM_BODY: fnPath.node,
            ALGORITHM_CODE: t.stringLiteral(path.hub.file.code.replace(/^export default /, '')),
          })
        );

        const bodyPath = fnPath.get('body');
        const params = Object.keys(bodyPath.scope.getAllBindingsOfKind('param'));
        bodyPath.unshiftContainer('body', createTraceCall({
          line: getPathLine(bodyPath),
          context: params,
          incrementCallCount: true,
        }));

        fnPath.traverse(innerVisitor, { bindings: params });
      }
    },
  };
}
