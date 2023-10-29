extends Node

class_name XMLData

#@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

enum NodeType {NODE_NONE, NODE_ELEMENT, NODE_ELEMENT_END, NODE_TEXT, 
NODE_COMMENT, NODE_CDATA, NODE_UNKNOWN}

func getNodeTypeName(nodeType: int):
	return NodeType.keys()[nodeType]

func getAllAttributes(parser: XMLParser)->String:
	var output = ""
	for i in parser.get_attribute_count():
		output += "%s: %s	" % [parser.get_attribute_name(i), parser.get_attribute_value(i)]

	return output

## get all attributes out of an XML element, could be NODE_ELEMENT or NODE_TEXT
func getAttributes(parser: XMLParser) -> Dictionary:
	var output := {}
	for i in parser.get_attribute_count():
		output[parser.get_attribute_name(i)] = parser.get_attribute_value(i)
	return output

func getAllNodeInfo(parser: XMLParser)->String:
	var output = ""
	var nodeType = parser.get_node_type()
	
	if nodeType == XMLParser.NODE_ELEMENT \
		|| nodeType == XMLParser.NODE_ELEMENT_END \
		|| nodeType == XMLParser.NODE_COMMENT \
		|| nodeType == XMLParser.NODE_CDATA:
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

## read XML file and create a body object
func readBodyFile(filepath: String): # return custom error probably
	var file = FileAccess.open(filepath, FileAccess.READ)
	var fileContents = file.get_as_text()
	var fileLines = fileContents.split("\n")
	file.close()
	
	var parser := XMLParser.new()

	var error = parser.open(filepath)
	if error != OK:
		print("error with opening file, %s" % error_string(error))
		return
	
	var nodeStack: = []
	var currentNodeName: String = ""
	
	while true:
		var nodeError = parser.read() 
		if nodeError != OK:
			if nodeError == ERR_FILE_EOF:
				break
			print("error with data, %s" % error_string(nodeError)) 
			return

		if parser.get_node_type() == XMLParser.NODE_ELEMENT:
			currentNodeName = parser.get_node_name()
			var attributes: Dictionary =  getAttributes(parser)
			nodeStack.push_back(attributes)
			if parser.is_empty():
				nodeStack.push_back(currentNodeName)
		
		if parser.get_node_type() == XMLParser.NODE_ELEMENT_END:
			var nodeName: String = parser.get_node_name()
			nodeStack.push_back(nodeName)

#				print("closing tag for <%s> not found, found </%s>\nat line %s: '%s'" % [
#					currentNodeName,
#					nodeName,
#					parser.get_current_line()+1,
#					fileLines[parser.get_current_line()]
#				]) 
#				return
				
		
#		match(currentNodeName):
#			"organ":
#				# confirm organ has required attributes
#				if(not attributes.has_all(["name", "id"])):
#					print("Line %s: organ does not have all required attributes\n'%s'" % [
#						parser.get_current_line()+1,
#						fileLines[parser.get_current_line()]
#					])
#					return
				
	
	print(nodeStack)

#func parseBody(parser: XMLParser)-> Dictionary:
#	var nodeError = parser.read() 
#	if nodeError != OK:
#		return {
#			"ERROR": "error with data, %s" % error_string(nodeError)
#		} 
#	var output: Dictionary = {}
#	if parser.get_node_type() == XMLParser.NODE_ELEMENT:
#		var nodeName: String = parser.get_node_name()
#		var attributes: Dictionary =  getAttributes(parser)
#		if parser.is_empty():
#
#
#	if parser.get_node_type() == XMLParser.NODE_ELEMENT_END:
#		var nodeName: String = parser.get_node_name()

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
