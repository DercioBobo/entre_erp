from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = [
        line.strip() for line in f if line.strip() and not line.startswith("#")
    ]

setup(
    name="entre_erp",
    version="0.0.1",
    description="Entre ERP — Custom ERPNext enhancements",
    author="Dércio Bobo",
    author_email="derciobob@gmail.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
