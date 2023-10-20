@tool
extends Node

#@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

@export var runCode: bool = false:
	set(_value):
		run()

#@export var ReadFile: bool = false:
#	set(_value):
#		readFile()

enum NodeType {NODE_NONE, NODE_ELEMENT, NODE_ELEMENT_END, NODE_TEXT, 
NODE_COMMENT, NODE_CDATA, NODE_UNKNOWN}

func getNodeTypeName(nodeType: int):
	return NodeType.keys()[nodeType]

func getAllAttributes(parser: XMLParser)->String:
	var output = ""
	for i in parser.get_attribute_count():
		output += "%s: %s	" % [parser.get_attribute_name(i), parser.get_attribute_value(i)]

	return output

func getAllNodeInfo(parser: XMLParser)->String:
	var output = ""
	var nodeType = parser.get_node_type()
	
	if nodeType == XMLParser.NODE_ELEMENT \
		|| nodeType == XMLParser.NODE_ELEMENT_END \
		|| nodeType == XMLParser.NODE_COMMENT:
		output += "<%s>\n" % parser.get_node_name()
	
	output += "%s\nIs Empty: %s\n%s\nOn line: %s, offset: %s" % [
		getNodeTypeName(nodeType),
		parser.is_empty(),
		getAllAttributes(parser),
		parser.get_current_line()+1,
		parser.get_node_offset()
	]
	
	if nodeType == XMLParser.NODE_TEXT:
		var text: String = parser.get_node_data()
		output += "\nText data: '%s' length: %s" % [text, text.length()]
	
	return output

func run():
	# Just to flex, also get the text content of the file
	var file = FileAccess.open("res://_extra/xmlTest.xml", FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open("res://_extra/xmlTest.xml")
	if error != OK:
		print("error with opening file, %s" % error_string(error))
		return
	
	while true:
		var nodeError = parser.read()
		if nodeError != OK:
			print("error with data, %s" % error_string(nodeError)) 
			return
		
		print("<==\n%s\n'%s'\n==/>" % [
			getAllNodeInfo(parser),
			fileLines[parser.get_current_line()].replace('\r', '')
		])
	
	parser.close()
