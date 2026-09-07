#include "bindings/bindings.h"

extern "C" void nstrans_install_bridge(void);

int main(int argc, char * argv[]) {
	nstrans_install_bridge();
	ffi::start_app();
	return 0;
}
