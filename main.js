var esprima = require("esprima");
var options = { tokens: true, tolerant: true, loc: true, range: true };
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');

function cartesianProductOf(args) {

	if (arguments.length > 1) args = _.toArray(arguments);
	// strings to arrays of letters
	args = _.map(args, opt => typeof opt === 'string' ? _.toArray(opt) : opt)

	return _.reduce(args, function (a, b) {
		return _.flatten(_.map(a, function (x) {
			return _.map(b, function (y) {
				return x.concat([y]);
			});
		}), true);
	}, [[]]);
};

function main() {
	// var x = {firstName:['Ben','Jade','Darren'],lastName:['Smith','Miller']};

	var args = process.argv.slice(2);

	if (args.length == 0) {
		args = ["subject.js"];
	}
	var filePath = args[0];

	constraints(filePath);

	generateTestCases()

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue(greaterThan, constraintValue) {
	if (greaterThan)
		return Random.integer(constraintValue, constraintValue + 10)(engine);
	else
		return Random.integer(constraintValue - 10, constraintValue)(engine);
}

function Constraint(properties) {
	this.ident = properties.ident;
	this.expression = properties.expression;
	this.operator = properties.operator;
	this.value = properties.value;
	this.altValue = properties.altValue;
	this.funcName = properties.funcName;
	// Supported kinds: "fileWithContent","fileExists"
	// integer, string, phoneNumber
	this.kind = properties.kind;
}

function fakeDemo() {
	console.log(faker.phone.phoneNumber());
	console.log(faker.phone.phoneNumberFormat());
	console.log(faker.phone.phoneFormats());
}

var functionConstraints =
	{
	}

var mockFileLibrary =
	{
		pathExists:
		{
			'path/noFile': {},
			'path/fileExists': {
				file: 'x.txt'
			}
		},
		fileWithContent:
		{
			pathContent:
			{
				file1: 'text content',
				file2: ''
			}
		}
	};

function generateTestCases() {

	var content = "var subject = require('./subject.js')\nvar mock = require('mock-fs');\n";
	for (var funcName in functionConstraints) {
		var params = {};


		// initialize params
		for (var i = 0; i < functionConstraints[funcName].params.length; i++) {
			var paramName = functionConstraints[funcName].params[i];
			//params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
			var constraintsTemp = functionConstraints[funcName].constraints;
			if (_.some(constraintsTemp, { kind: 'fileWithContent' }) || _.some(constraintsTemp, { kind: 'fileExists' })) {
				params[paramName] = [];
			}
			else {
				params[paramName] = ['\'\''];
			}

		}

		//console.log("PARAMS")
		//console.log( params );

		// update parameter values based on known constraints.
		var constraints = functionConstraints[funcName].constraints;
		// Handle global constraints...
		var fileWithContent = _.some(constraints, { kind: 'fileWithContent' });
		var pathExists = _.some(constraints, { kind: 'fileExists' });

		// plug-in values for parameters
		for (var c = 0; c < constraints.length; c++) {
			var constraint = constraints[c];
			if (params.hasOwnProperty(constraint.ident)) {
				params[constraint.ident] = _.uniq(params[constraint.ident].concat(constraint.value));
			}
		}

		// Prepare function arguments.
		//console.log(cartesianProductOf([['a','b'],[1,2]]));
		var argsList = cartesianProductOf(_.values(params));

		for (var i in argsList) {
			var args = argsList[i].join(',');
			console.log(args)
			//				args =  args.join(',');
			if (pathExists || fileWithContent) {
				content += generateMockFsTestCases(pathExists, fileWithContent, funcName, args);
				// Bonus...generate constraint variations test cases....
				content += generateMockFsTestCases(!pathExists, fileWithContent, funcName, args);
				content += generateMockFsTestCases(pathExists, !fileWithContent, funcName, args);
				content += generateMockFsTestCases(!pathExists, !fileWithContent, funcName, args);
			}
			else {
				// Emit simple test case.
				content += "subject.{0}({1});\n".format(funcName, args);
				// content += "subject.{0}({1});\n".format(funcName, altArgs );
			}
		}
		//console.log(funcName+":-")
		//console.log(content);

	}


	fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases(pathExists, fileWithContent, funcName, args) {
	var testCase = "";
	// Build mock file system based on constraints.
	var mergedFS = {};
	if (pathExists) {
		for (var attrname in mockFileLibrary.pathExists) {
			mergedFS[attrname] = mockFileLibrary.pathExists[attrname];
		}
	}
	if (fileWithContent) {
		for (var attrname in mockFileLibrary.fileWithContent) { mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname]; }
	}

	testCase +=
		"mock(" +
		JSON.stringify(mergedFS)
		+
		");\n";

	testCase += "\tsubject.{0}({1});\n".format(funcName, args);
	testCase += "mock.restore();\n";
	return testCase;
}

function constraints(filePath) {
	var buf = fs.readFileSync(filePath, "utf8");
	var result = esprima.parse(buf, options);

	traverse(result, function (node) {
		if (node.type === 'FunctionDeclaration') {
			var funcName = functionName(node);
			console.log("Line : {0} Function: {1}".format(node.loc.start.line, funcName));

			var params = node.params.map(function (p) { return p.name });

			functionConstraints[funcName] = { constraints: [], params: params };

			// Check for expressions using argument.
			traverse(node, function (child) {

				if (child.type === 'BinaryExpression' && (child.operator == "<" || child.operator == ">"
					|| child.operator == ">=" || child.operator == "<=" || child.operator == "==" || child.operator == "!=")) {
					if (child.left.type == 'Identifier' && params.indexOf(child.left.name) > -1) {
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
						var possibleValues;
						if (!isNaN(rightHand)) {
							possibleValues = [parseInt(rightHand), parseInt(rightHand) - 1, parseInt(rightHand) + 1];
						}
						else {
							possibleValues = [rightHand, '"randomString"'];
						}
						functionConstraints[funcName].constraints.push(
							new Constraint(
								{
									ident: child.left.name,
									value: possibleValues,
									funcName: funcName,
									kind: "integer",
									operator: child.operator,
									expression: expression
								}));
					}
				}



				if (child.type == "CallExpression" &&
					child.callee.property &&
					child.callee.property.name == "readFileSync") {
					for (var p = 0; p < params.length; p++) {
						if (child.arguments[0].name == params[p]) {
							functionConstraints[funcName].constraints.push(
								new Constraint(
									{
										ident: "filePath",
										value: ["'pathContent/file1'", "'pathContent/file2'"],
										funcName: funcName,
										kind: "fileWithContent",
										operator: child.operator,
										expression: expression
									}));
						}
					}
				}

				if (child.type == "CallExpression" &&
					child.callee.property &&
					child.callee.property.name == "existsSync") {
					for (var p = 0; p < params.length; p++) {
						if (child.arguments[0].name == params[p]) {
							functionConstraints[funcName].constraints.push(
								new Constraint(
									{
										ident: "dir",
										// A fake path to a file
										value: ["'path/fileExists'", "'path/noFile'"],
										funcName: funcName,
										kind: "fileExists",
										operator: child.operator,
										expression: expression
									}));
						}
					}
				}

				if (child.type == "BinaryExpression" &&
					child.left.type == "CallExpression" &&
					child.left.callee.property &&
					child.left.callee.property.name == "indexOf") {

					var expression = buf.substring(child.range[0], child.range[1]);
					var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
					var indexOfString = child.left.arguments[0].value;
					var possibleValues;

					if (!isNaN(rightHand) && parseInt(rightHand) != 0) {
						possibleValues = ['"' + indexOfString + '"', '"' + Random.string(engine, parseInt(rightHand)) + '"', '"' + Random.string(engine, parseInt(rightHand) + 1) + '"'];
					}
					else {
						possibleValues = ['"' + indexOfString + '"'];
					}
					functionConstraints[funcName].constraints.push(
						new Constraint(
							{
								ident: child.left.callee.object.name,
								value: possibleValues,
								funcName: funcName,
								kind: "indexOf",
								operator: child.operator,
								expression: expression
							}));
				}

				if (child.type == "LogicalExpression" && child.left.type == "UnaryExpression") {

					var expression = buf.substring(child.range[0], child.range[1]);

					functionConstraints[funcName].constraints.push(
						new Constraint(
							{
								ident: child.left.argument.name,
								value: [true, false],
								funcName: funcName,
								kind: "format",
								operator: child.operator,
								expression: expression
							}));
				}

				if (child.type == "UnaryExpression" && child.argument.property) {

					var property = child.argument.property.name;

					var expression = buf.substring(child.range[0], child.range[1]);
					var possibleValues = ["{" + "\"" + property + "\": true}", "{" + "\"" + property + "\": false}"];
					functionConstraints[funcName].constraints.push(
						new Constraint(
							{
								ident: child.argument.object.name,
								value: possibleValues,
								funcName: funcName,
								kind: "format",
								operator: child.operator,
								expression: expression
							}));
				}

				if (child.type == "CallExpression" && child.callee.name == "normalize") {

					console.log(faker.phone.phoneFormats());
					console.log(faker.phone.phoneNumberFormat('(###)###-####'));
					var possibleValues = ['"' + faker.phone.phoneNumber() + '"'];
					functionConstraints[funcName].constraints.push(
						new Constraint(
							{
								ident: child.arguments[0].name,
								value: possibleValues,
								funcName: funcName,
								kind: "format",
								operator: child.operator,
								expression: expression
							}));
				}

				if (child.type === 'BinaryExpression' && (child.operator == "==" || child.operator == "!=") &&
					child.left.type == 'Identifier' && child.left.name == "area") {
					// get expression from original source code:
					var expression = buf.substring(child.range[0], child.range[1]);
					var rightHand = buf.substring(child.right.range[0], child.right.range[1]);

					var possibleValues = ['"' + faker.phone.phoneNumber('(' + rightHand.substring(1, 4) + ')###-####') + '"', '"' + faker.phone.phoneNumber() + '"'];
					functionConstraints[funcName].constraints.push(
						new Constraint(
							{
								ident: "phoneNumber",
								value: possibleValues,
								funcName: funcName,
								kind: "phoneNumber",
								operator: child.operator,
								expression: expression
							}));
				}



			});



			console.log(functionConstraints[funcName]);

		}
	});
}

function traverse(object, visitor) {
	var key, child;

	visitor.call(null, object);
	for (key in object) {
		if (object.hasOwnProperty(key)) {
			child = object[key];
			if (typeof child === 'object' && child !== null) {
				traverse(child, visitor);
			}
		}
	}
}

function traverseWithCancel(object, visitor) {
	var key, child;

	if (visitor.call(null, object)) {
		for (key in object) {
			if (object.hasOwnProperty(key)) {
				child = object[key];
				if (typeof child === 'object' && child !== null) {
					traverseWithCancel(child, visitor);
				}
			}
		}
	}
}

function functionName(node) {
	if (node.id) {
		return node.id.name;
	}
	return "";
}


if (!String.prototype.format) {
	String.prototype.format = function () {
		var args = arguments;
		return this.replace(/{(\d+)}/g, function (match, number) {
			return typeof args[number] != 'undefined'
				? args[number]
				: match
				;
		});
	};
}

main();
