# The maintenances created from a modelo, under Connections. Here and not in
# the doctype's links: those would make the two doctypes depend on each other
# when migrate creates them.


def get_data():
	return {
		"fieldname": "modelo",
		"transactions": [{"items": ["Manutencao Programada"]}],
	}
