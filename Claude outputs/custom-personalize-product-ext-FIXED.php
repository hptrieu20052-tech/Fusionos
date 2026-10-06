<?php
defined( 'ABSPATH' ) || exit;

/**
 * FUSION upgrade 10/2026: ho tro them type=select (List of options) + max=N (gioi han ky tu
 * cho type=field) trong meta _custom_options — de FUSION Manage Products Woo dat Custom options
 * giong Etsy/Shopify. Format moi (van tuong thich nguoc 100% voi format cu):
 *   name=Ten,type=field,required=1,max=100
 *   name=Skin Color,type=select,required=1,options=Fair;Tan;Dark
 *   name=Photo,type=file,required=0
 */

/**
 * Parse 1 chuoi _custom_options item -> attr map (dung chung cho render/cart/order)
 */
function wcp_parse_custom_attrs( $item_str ) {
    $attributes = explode( ',', trim( $item_str ) );
    $attr_map = array();
    foreach ( $attributes as $attr_part ) {
        $pair = explode( '=', trim( $attr_part ), 2 );
        if ( count( $pair ) === 2 ) {
            $attr_map[ trim( $pair[0] ) ] = trim( $pair[1] );
        }
    }
    return $attr_map;
}

/**
 * Render custom fields on single product page before add to cart quantity (Only for simple products)
 */
add_action( 'woocommerce_before_add_to_cart_quantity', 'kia_custom_option', 9 );
function kia_custom_option() {
    global $product;

    if ( ! is_a( $product, 'WC_Product' ) ) {
        $product = wc_get_product( get_the_ID() );
    }

    if ( ! $product || ! $product->is_type( 'simple' ) ) {
        return;
    }

    $custom_options = $product->get_meta( '_custom_options', true );
    if ( empty( $custom_options ) ) {
        $custom_options = get_post_meta( $product->get_id(), '_custom_options', true );
    }

    if ( ! empty( $custom_options ) ) {
        $arr = explode( '|', $custom_options );
        foreach ( $arr as $item_str ) {
            $item_str = trim( $item_str );
            if ( empty( $item_str ) ) {
                continue;
            }

            $attr_map = wcp_parse_custom_attrs( $item_str );

            $raw_name = isset( $attr_map['name'] ) ? $attr_map['name'] : '';
            $type     = isset( $attr_map['type'] ) ? $attr_map['type'] : 'field';
            $required = isset( $attr_map['required'] ) && $attr_map['required'] == '1' ? 'required' : '';

            if ( empty( $raw_name ) ) {
                continue;
            }

            $field_name = strtolower( preg_replace( '/[^a-zA-Z0-9]/', '_', $raw_name ) );

            if ( $type === 'field' ) {
                // FUSION: max=N -> gioi han ky tu o nhap
                $maxlen = isset( $attr_map['max'] ) && is_numeric( $attr_map['max'] ) ? intval( $attr_map['max'] ) : 0;
                $maxattr = $maxlen > 0 ? ' maxlength="' . esc_attr( $maxlen ) . '"' : '';
                echo '<div class="wcp-custom-field-wrap" style="margin-bottom: 10px;">';
                echo '<label for="' . esc_attr( $field_name ) . '" style="display:block; font-weight:600; margin-bottom: 4px;">' . esc_html( $raw_name ) . '</label>';
                echo '<input type="text" id="' . esc_attr( $field_name ) . '" name="' . esc_attr( $field_name ) . '" class="input-text" style="width:100%; border-radius: 5px; padding: 8px; border: 1px solid #ccc;"' . $maxattr . ' ' . $required . '>';
                echo '</div>';
            } elseif ( $type === 'select' ) {
                // FUSION: List of options -> dropdown. options=a;b;c
                $opts_raw = isset( $attr_map['options'] ) ? $attr_map['options'] : '';
                $opts = array_values( array_filter( array_map( 'trim', explode( ';', $opts_raw ) ) ) );
                if ( empty( $opts ) ) {
                    continue;
                }
                echo '<div class="wcp-custom-select-wrap" style="margin-bottom: 10px;">';
                echo '<label for="' . esc_attr( $field_name ) . '" style="display:block; font-weight:600; margin-bottom: 4px;">' . esc_html( $raw_name ) . '</label>';
                echo '<select id="' . esc_attr( $field_name ) . '" name="' . esc_attr( $field_name ) . '" style="width:100%; border-radius: 5px; padding: 8px; border: 1px solid #ccc; background:#fff;" ' . $required . '>';
                echo '<option value="">— Select ' . esc_html( $raw_name ) . ' —</option>';
                foreach ( $opts as $opt ) {
                    echo '<option value="' . esc_attr( $opt ) . '">' . esc_html( $opt ) . '</option>';
                }
                echo '</select>';
                echo '</div>';
            } elseif ( $type === 'file' ) {
                echo '<div class="wcp-custom-file-wrap" style="margin-bottom: 10px;">';
                echo '<label for="' . esc_attr( $field_name ) . '" style="display:block; font-weight:600; margin-bottom: 4px;">' . esc_html( $raw_name ) . '</label>';
                echo '<input type="file" id="' . esc_attr( $field_name ) . '" name="' . esc_attr( $field_name ) . '" accept="image/*" style="border-radius: 5px; padding: 5px;" ' . $required . '>';
                echo '</div>';
            }
        }
    }
}

/**
 * Add custom fields data into cart item (Only for simple products)
 */
add_filter( 'woocommerce_add_cart_item_data', 'kia_add_cart_item_data', 10, 3 );
function kia_add_cart_item_data( $cart_item, $product_id, $variation_id = 0 ) {
    $product = wc_get_product( $product_id );
    if ( ! $product || ! $product->is_type( 'simple' ) ) {
        return $cart_item;
    }

    $custom_options = get_post_meta( $product_id, '_custom_options', true );
    if ( ! empty( $custom_options ) ) {
        $arr = explode( '|', $custom_options );
        foreach ( $arr as $item_str ) {
            $item_str = trim( $item_str );
            if ( empty( $item_str ) ) {
                continue;
            }

            $attr_map = wcp_parse_custom_attrs( $item_str );

            $raw_name = isset( $attr_map['name'] ) ? $attr_map['name'] : '';
            $type     = isset( $attr_map['type'] ) ? $attr_map['type'] : 'field';

            if ( empty( $raw_name ) ) {
                continue;
            }

            $field_name = strtolower( preg_replace( '/[^a-zA-Z0-9]/', '_', $raw_name ) );

            // FUSION: select nhan gia tri nhu field (gia tri la 1 trong cac options)
            if ( ( $type === 'field' || $type === 'select' ) && isset( $_POST[ $field_name ] ) ) {
                $cart_item[ $field_name ] = sanitize_text_field( wp_unslash( $_POST[ $field_name ] ) );
                $cart_item['unique_key']  = md5( microtime() . wp_rand() );
            } elseif ( $type === 'file' ) {
                if ( ! empty( $_FILES[ $field_name ]['name'] ) && ! empty( $_FILES[ $field_name ]['tmp_name'] ) ) {
                    if ( ! function_exists( 'wp_handle_upload' ) ) {
                        require_once ABSPATH . 'wp-admin/includes/file.php';
                    }

                    $file = $_FILES[ $field_name ];
                    // Validate allowed image types
                    $allowed_types = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp' );
                    $check_type = wp_check_filetype( $file['name'] );

                    if ( in_array( $file['type'], $allowed_types, true ) || in_array( $check_type['type'], $allowed_types, true ) ) {
                        $upload = wp_upload_bits( $file['name'], null, file_get_contents( $file['tmp_name'] ) );
                        if ( empty( $upload['error'] ) ) {
                            $upload_dir   = wp_upload_dir();
                            $upl_base_url = is_ssl() ? str_replace( 'http://', 'https://', $upload_dir['baseurl'] ) : $upload_dir['baseurl'];
                            $base_name    = basename( $upload['file'] );

                            $cart_item[ $field_name ] = array(
                                'guid'      => $upl_base_url . '/' . _wp_relative_upload_path( $upload['file'] ),
                                'file_type' => $check_type['type'],
                                'file_name' => $base_name,
                                'title'     => ucfirst( preg_replace( '/\.[^.]+$/', '', $base_name ) ),
                            );
                            $cart_item['unique_key'] = md5( microtime() . wp_rand() );
                        }
                    }
                }
            }
        }
    }

    return $cart_item;
}

/**
 * Display custom fields in cart & checkout
 */
add_filter( 'woocommerce_get_item_data', 'customizing_cart_item_data_2', 10, 2 );
function customizing_cart_item_data_2( $cart_data, $cart_item ) {
    $custom_items = ! empty( $cart_data ) && is_array( $cart_data ) ? $cart_data : array();

    if ( empty( $cart_item['product_id'] ) ) {
        return $custom_items;
    }

    $product_id = $cart_item['product_id'];
    $custom_options = get_post_meta( $product_id, '_custom_options', true );

    if ( ! empty( $custom_options ) ) {
        $arr = explode( '|', $custom_options );
        foreach ( $arr as $item_str ) {
            $item_str = trim( $item_str );
            if ( empty( $item_str ) ) {
                continue;
            }

            $attr_map = wcp_parse_custom_attrs( $item_str );

            $raw_name = isset( $attr_map['name'] ) ? $attr_map['name'] : '';
            $type     = isset( $attr_map['type'] ) ? $attr_map['type'] : 'field';

            if ( empty( $raw_name ) ) {
                continue;
            }

            $field_name = strtolower( preg_replace( '/[^a-zA-Z0-9]/', '_', $raw_name ) );

            if ( ( $type === 'field' || $type === 'select' ) && ! empty( $cart_item[ $field_name ] ) ) {
                $custom_items[] = array(
                    'key'   => $raw_name,
                    'name'  => $raw_name,
                    'value' => esc_html( $cart_item[ $field_name ] ),
                );
            } elseif ( $type === 'file' && ! empty( $cart_item[ $field_name ]['guid'] ) ) {
                $custom_items[] = array(
                    'key'   => $raw_name,
                    'name'  => $raw_name,
                    'value' => sprintf( '<a href="%s" target="_blank">%s</a>', esc_url( $cart_item[ $field_name ]['guid'] ), esc_html( $cart_item[ $field_name ]['file_name'] ) ),
                );
            }
        }
    }

    return $custom_items;
}

/**
 * Save custom fields to order line item (HPOS & WC 11.x CRUD compatible)
 */
add_action( 'woocommerce_checkout_create_order_line_item', 'adding_custom_data_in_order_items_meta_v2', 10, 4 );
function adding_custom_data_in_order_items_meta_v2( $item, $cart_item_key, $values, $order ) {
    if ( empty( $values['product_id'] ) ) {
        return;
    }

    $product_id = $values['product_id'];
    $custom_options = get_post_meta( $product_id, '_custom_options', true );

    if ( ! empty( $custom_options ) ) {
        $arr = explode( '|', $custom_options );
        foreach ( $arr as $item_str ) {
            $item_str = trim( $item_str );
            if ( empty( $item_str ) ) {
                continue;
            }

            $attr_map = wcp_parse_custom_attrs( $item_str );

            $raw_name = isset( $attr_map['name'] ) ? $attr_map['name'] : '';
            $type     = isset( $attr_map['type'] ) ? $attr_map['type'] : 'field';

            if ( empty( $raw_name ) ) {
                continue;
            }

            $field_name = strtolower( preg_replace( '/[^a-zA-Z0-9]/', '_', $raw_name ) );

            if ( ( $type === 'field' || $type === 'select' ) && isset( $values[ $field_name ] ) ) {
                $item->add_meta_data( $raw_name, sanitize_text_field( $values[ $field_name ] ), true );
            } elseif ( $type === 'file' && isset( $values[ $field_name ]['guid'] ) ) {
                $item->add_meta_data( $raw_name, esc_url_raw( $values[ $field_name ]['guid'] ), true );
            }
        }
    }
}

/**
 * Add-to-cart validation (Only for simple products)
 */
add_filter( 'woocommerce_add_to_cart_validation', 'kia_add_to_cart_validation', 10, 3 );
function kia_add_to_cart_validation( $passed, $product_id, $qty ) {
    $product = wc_get_product( $product_id );
    if ( ! $product || ! $product->is_type( 'simple' ) ) {
        return $passed;
    }

    if ( isset( $_POST['cust_text_01'] ) && sanitize_text_field( wp_unslash( $_POST['cust_text_01'] ) ) === '' ) {
        $title = $product->get_title();
        wc_add_notice( sprintf( __( '%s! Please input text.', 'woo-custom-pro' ), esc_html( $title ) ), 'error' );
        return false;
    }

    return $passed;
}

/**
 * Register Personalize tab in product edit admin screen (Only for simple products)
 */
add_filter( 'woocommerce_product_data_tabs', 'custom_product_tabs' );
function custom_product_tabs( $tabs ) {
    $tabs['rental'] = array(
        'label'    => __( 'Personalize', 'woocommerce' ),
        'target'   => 'rental_options',
        'class'    => array( 'show_if_simple' ),
        'priority' => 60,
    );

    return $tabs;
}

/**
 * Render tab content panel
 */
add_action( 'woocommerce_product_data_panels', 'rental_options_product_tab_content' );
function rental_options_product_tab_content() {
    global $post, $product_object;

    $product_id = 0;
    if ( is_a( $product_object, 'WC_Product' ) ) {
        $product_id = $product_object->get_id();
    } elseif ( ! empty( $post->ID ) ) {
        $product_id = $post->ID;
    }

    $custom_type = $product_id ? get_post_meta( $product_id, '_custom_type', true ) : 'normal';
    $custom_options = $product_id ? get_post_meta( $product_id, '_custom_options', true ) : '';

    ?>
    <div id="rental_options" class="panel woocommerce_options_panel">
        <div class="options_group">
            <?php
            woocommerce_wp_select( array(
                'id'          => '_custom_type',
                'label'       => __( 'Product Type By System', 'woo-custom-pro' ),
                'desc_tip'    => true,
                'description' => __( 'Select custom product type.', 'woo-custom-pro' ),
                'value'       => $custom_type ? $custom_type : 'normal',
                'options'     => array(
                    'normal' => __( 'Normal', 'woocommerce' ),
                    'custom' => __( 'Custom', 'woocommerce' ),
                ),
            ) );

            woocommerce_wp_textarea_input( array(
                'id'          => '_custom_options',
                'label'       => __( 'Custom Options', 'woo-custom-pro' ),
                'placeholder' => 'name=Text,type=field,required=1,max=100|name=Color,type=select,required=1,options=Red;Blue|name=Photo,type=file,required=0',
                'desc_tip'    => true,
                'rows'        => 6,
                'value'       => $custom_options,
                'description' => __( 'Format: name=FieldName,type=field|select|file,required=1[,max=100][,options=a;b;c] separated by |', 'woo-custom-pro' ),
            ) );
            ?>
        </div>
    </div>
    <?php
}

/**
 * Save custom meta on product update
 */
add_action( 'woocommerce_process_product_meta', 'woo_add_custom_text_field_title_110_save' );
function woo_add_custom_text_field_title_110_save( $post_id ) {
    $product = wc_get_product( $post_id );
    if ( ! $product ) {
        return;
    }

    if ( isset( $_POST['_custom_type'] ) ) {
        $custom_type = sanitize_text_field( wp_unslash( $_POST['_custom_type'] ) );
        $product->update_meta_data( '_custom_type', $custom_type );
    }

    if ( isset( $_POST['_custom_options'] ) ) {
        $custom_options = sanitize_textarea_field( wp_unslash( $_POST['_custom_options'] ) );
        $product->update_meta_data( '_custom_options', $custom_options );
    }

    $product->save_meta_data();
}
